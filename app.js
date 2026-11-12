const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { abrirBanco } = require('./database');

const PUBLICA = path.join(__dirname, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const STATUS_SALAS = ['Disponível', 'Inativa'];
const STATUS_RESERVAS = ['Ativa', 'Cancelada'];

function texto(valor) { return typeof valor === 'string' ? valor.trim() : ''; }
function numeroInteiro(valor) {
  if (valor === '' || valor === null || valor === undefined) return NaN;
  const n = Number(valor);
  return Number.isInteger(n) ? n : NaN;
}
function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}
function responder(res, status, conteudo, cabecalhos = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos });
  res.end(JSON.stringify(conteudo));
}
function ehDataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return dt.getUTCFullYear() === ano && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === dia;
}
function ehHoraValida(hora) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}
function validarSala(dados) {
  const nome = texto(dados.nome);
  const localizacao = texto(dados.localizacao);
  const capacidade = numeroInteiro(dados.capacidade);
  const situacao = dados.situacao || 'Disponível';
  const recursos = Array.isArray(dados.recursos)
    ? dados.recursos.map(texto).filter(Boolean)
    : texto(dados.recursos).split(',').map(v => v.trim()).filter(Boolean);
  if (!nome || !localizacao) throw erro('Informe o nome e a localização da sala.');
  if (!Number.isInteger(capacidade) || capacidade < 1) throw erro('A capacidade deve ser um número inteiro maior que zero.');
  if (!STATUS_SALAS.includes(situacao)) throw erro('Situação da sala inválida.');
  return { nome, localizacao, capacidade, recursos: [...new Set(recursos)], situacao };
}
function validarReserva(dados, salas, reservas, ignorarId = null, anterior = null) {
  const aluno = texto(dados.aluno);
  const email = texto(dados.email);
  const salaId = numeroInteiro(dados.salaId);
  const data = texto(dados.data);
  const inicio = texto(dados.inicio);
  const fim = texto(dados.fim);
  const participantes = numeroInteiro(dados.participantes);
  const finalidade = texto(dados.finalidade);
  const status = dados.status || 'Ativa';

  if (!aluno || !email || !finalidade || !data || !inicio || !fim) throw erro('Preencha todos os campos obrigatórios da reserva.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro('Informe um e-mail válido.');
  if (!ehDataValida(data)) throw erro('Data da reserva inválida. Use AAAA-MM-DD.');
  if (!ehHoraValida(inicio) || !ehHoraValida(fim) || fim <= inicio) throw erro('O horário final deve ser posterior ao horário inicial.');
  if (!STATUS_RESERVAS.includes(status)) throw erro('Status da reserva inválido.');
  if (!Number.isInteger(participantes) || participantes < 1) throw erro('Informe uma quantidade válida de participantes.');

  const sala = salas.find(s => s.id === salaId);
  if (!sala) throw erro('Sala não encontrada. Selecione uma sala cadastrada.', 404);
  if (participantes > sala.capacidade) throw erro(`A sala comporta no máximo ${sala.capacidade} participante(s).`, 409);

  // Uma sala que ficou inativa mantém as reservas antigas, mas não recebe novas reservas ativas.
  const novaReservaOuReagendamento = !anterior || anterior.salaId !== salaId ||
    (status === 'Ativa' && (anterior.status !== 'Ativa' || anterior.data !== data ||
     anterior.inicio !== inicio || anterior.fim !== fim));
  if (sala.situacao === 'Inativa' && novaReservaOuReagendamento) throw erro('A sala está inativa e não pode receber novas reservas.', 409);

  if (status === 'Ativa') {
    const conflito = reservas.some(r => r.id !== ignorarId && r.status === 'Ativa' &&
      r.salaId === salaId && r.data === data && inicio < r.fim && fim > r.inicio);
    if (conflito) throw erro('Conflito de horário: já existe uma reserva ativa nesse período para esta sala.', 409);
  }
  return { aluno, email, salaId, data, inicio, fim, participantes, finalidade, status };
}
async function lerCorpo(req) {
  let corpo = '';
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 100000) throw erro('Dados enviados são muito grandes.', 413);
  }
  try {
    const dados = JSON.parse(corpo);
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error();
    return dados;
  } catch { throw erro('Envie um objeto JSON válido.'); }
}

function criarServidor(opcoes = {}) {
  const { banco, salvar } = abrirBanco(opcoes.arquivoBanco);
  const buscarFeriados = opcoes.buscarFeriados || (async (ano) => {
    const resposta = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(7000)
    });
    if (!resposta.ok) throw new Error(`BrasilAPI retornou HTTP ${resposta.status}`);
    const feriados = await resposta.json();
    if (!Array.isArray(feriados)) throw new Error('Resposta inesperada da BrasilAPI');
    return feriados;
  });
  const cacheFeriados = new Map();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rota = url.pathname;
      const metodo = req.method;

      if (rota === '/api/salas') {
        if (metodo === 'GET') return responder(res, 200, banco.salas);
        if (metodo === 'POST') {
          const campos = validarSala(await lerCorpo(req));
          const sala = { id: banco.proximoIdSala++, ...campos };
          banco.salas.push(sala);
          salvar();
          return responder(res, 201, sala, { Location: `/api/salas/${sala.id}` });
        }
        return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, POST' });
      }

      const rotaSala = rota.match(/^\/api\/salas\/(\d+)$/);
      if (rotaSala) {
        const id = Number(rotaSala[1]);
        const indice = banco.salas.findIndex(s => s.id === id);
        if (!['GET', 'PUT', 'DELETE'].includes(metodo)) return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, PUT, DELETE' });
        if (indice < 0) throw erro('Sala não encontrada.', 404);
        if (metodo === 'GET') return responder(res, 200, banco.salas[indice]);
        if (metodo === 'DELETE') {
          if (banco.reservas.some(r => r.salaId === id)) throw erro('Não é possível excluir uma sala com reservas vinculadas.', 409);
          banco.salas.splice(indice, 1);
          salvar();
          return responder(res, 200, { mensagem: 'Sala excluída com sucesso.' });
        }
        const campos = validarSala(await lerCorpo(req));
        const reservaExcedida = banco.reservas.some(r => r.salaId === id && r.status === 'Ativa' && r.participantes > campos.capacidade);
        if (reservaExcedida) throw erro('A nova capacidade é menor que a quantidade de participantes de uma reserva ativa.', 409);
        banco.salas[indice] = { id, ...campos };
        salvar();
        return responder(res, 200, banco.salas[indice]);
      }

      if (rota === '/api/reservas') {
        if (metodo === 'GET') {
          const data = url.searchParams.get('data');
          const salaId = url.searchParams.get('salaId');
          const status = url.searchParams.get('status');
          let lista = banco.reservas;
          if (data) lista = lista.filter(r => r.data === data);
          if (salaId) lista = lista.filter(r => r.salaId === Number(salaId));
          if (status) lista = lista.filter(r => r.status === status);
          return responder(res, 200, lista);
        }
        if (metodo === 'POST') {
          const campos = validarReserva(await lerCorpo(req), banco.salas, banco.reservas);
          const reserva = { id: banco.proximoIdReserva++, ...campos };
          banco.reservas.push(reserva);
          salvar();
          return responder(res, 201, reserva, { Location: `/api/reservas/${reserva.id}` });
        }
        return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, POST' });
      }

      const rotaReserva = rota.match(/^\/api\/reservas\/(\d+)$/);
      if (rotaReserva) {
        const id = Number(rotaReserva[1]);
        const indice = banco.reservas.findIndex(r => r.id === id);
        if (!['GET', 'PUT', 'DELETE'].includes(metodo)) return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, PUT, DELETE' });
        if (indice < 0) throw erro('Reserva não encontrada.', 404);
        if (metodo === 'GET') return responder(res, 200, banco.reservas[indice]);
        if (metodo === 'DELETE') {
          banco.reservas.splice(indice, 1);
          salvar();
          return responder(res, 200, { mensagem: 'Reserva excluída com sucesso.' });
        }
        const anterior = banco.reservas[indice];
        const campos = validarReserva(await lerCorpo(req), banco.salas, banco.reservas, id, anterior);
        banco.reservas[indice] = { id, ...campos };
        salvar();
        return responder(res, 200, banco.reservas[indice]);
      }

      const rotaFeriado = rota.match(/^\/api\/feriados\/(\d{4})$/);
      if (rotaFeriado) {
        if (metodo !== 'GET') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
        const ano = Number(rotaFeriado[1]);
        if (ano < 1900 || ano > 2100) throw erro('Ano inválido para consulta de feriados.');
        try {
          const registro = cacheFeriados.get(ano);
          if (registro && Date.now() - registro.data < 3600000) return responder(res, 200, registro.feriados);
          const feriados = await buscarFeriados(ano);
          if (!Array.isArray(feriados)) throw new Error('Resposta inválida da API externa.');
          cacheFeriados.set(ano, { feriados, data: Date.now() });
          return responder(res, 200, feriados);
        } catch {
          return responder(res, 502, { erro: 'Não foi possível consultar os feriados agora. A reserva pode continuar normalmente.' });
        }
      }

      if (rota.startsWith('/api/')) throw erro('Rota da API não encontrada.', 404);

      const paginas = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/script.js': 'script.js' };
      const arquivo = paginas[rota];
      if (!arquivo || !['GET', 'HEAD'].includes(metodo)) throw erro('Página não encontrada.', 404);
      const conteudo = fs.readFileSync(path.join(PUBLICA, arquivo));
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)], 'X-Content-Type-Options': 'nosniff' });
      return res.end(metodo === 'HEAD' ? undefined : conteudo);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      responder(res, status, { erro: status === 500 ? 'Ocorreu um erro interno no servidor.' : e.message });
    }
  });
}

if (require.main === module) {
  const porta = Number(process.env.PORT) || 5000;
  criarServidor().listen(porta, () => console.log(`Servidor em http://localhost:${porta}`));
}

module.exports = { criarServidor };
