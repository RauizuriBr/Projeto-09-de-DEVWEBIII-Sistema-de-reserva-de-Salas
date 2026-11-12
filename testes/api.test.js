const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarServidor } = require('../app');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-reserva-salas-'));
const arquivoBanco = path.join(pasta, 'banco.json');
let servidor;
let endereco;
let salaId;
let reservaId;

const dadosSala = {
  nome: 'Laboratório de Informática', localizacao: 'Bloco A', capacidade: 6,
  recursos: ['Computadores', 'Projetor'], situacao: 'Disponível'
};
const dadosReserva = {
  aluno: 'Aluno de Teste', email: 'aluno@exemplo.com', salaId: 1,
  data: '2026-11-20', inicio: '09:00', fim: '10:30',
  participantes: 4, finalidade: 'Trabalho acadêmico', status: 'Ativa'
};

async function iniciar() {
  servidor = criarServidor({
    arquivoBanco,
    buscarFeriados: async (ano) => ano === 2026 ? [{ date: '2026-11-20', name: 'Consciência Negra', type: 'national' }] : []
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  endereco = `http://127.0.0.1:${servidor.address().port}`;
}
async function parar() { if (servidor) await new Promise(resolve => servidor.close(resolve)); }
async function requisicao(rota, metodo = 'GET', dados) {
  const resposta = await fetch(endereco + rota, {
    method: metodo,
    headers: dados ? { 'Content-Type': 'application/json' } : {},
    body: dados ? JSON.stringify(dados) : undefined
  });
  const resultado = await resposta.json();
  return { status: resposta.status, resultado, headers: resposta.headers };
}

before(iniciar);
after(async () => { await parar(); fs.rmSync(pasta, { recursive: true, force: true }); });

test('A página principal é servida como HTML', async () => {
  const r = await fetch(endereco);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Reserva de Salas/);
});

test('Sala: valida obrigatórios e cria com ID automático', async () => {
  const invalida = await requisicao('/api/salas', 'POST', { nome: 'Sala sem capacidade' });
  assert.equal(invalida.status, 400);
  const r = await requisicao('/api/salas', 'POST', dadosSala);
  assert.equal(r.status, 201);
  salaId = r.resultado.id;
  assert.equal(salaId, 1);
  assert.equal(r.resultado.recursos.length, 2);
  assert.equal((await requisicao(`/api/salas/${salaId}`)).resultado.nome, dadosSala.nome);
});

test('Sala: rejeita capacidade zero e status inválido', async () => {
  assert.equal((await requisicao('/api/salas', 'POST', { ...dadosSala, capacidade: 0 })).status, 400);
  assert.equal((await requisicao('/api/salas', 'POST', { ...dadosSala, situacao: 'Indefinida' })).status, 400);
});

test('Reserva: valida horário e limites de capacidade', async () => {
  const reserva = { ...dadosReserva, salaId };
  assert.equal((await requisicao('/api/reservas', 'POST', { ...reserva, fim: '08:00' })).status, 400);
  assert.equal((await requisicao('/api/reservas', 'POST', { ...reserva, data: '2026-02-30' })).status, 400);
  assert.equal((await requisicao('/api/reservas', 'POST', { ...reserva, participantes: 7 })).status, 409);
  assert.equal((await requisicao('/api/reservas', 'POST', { ...reserva, salaId: 999 })).status, 404);
});

test('Reserva: cria, consulta e bloqueia conflito parcial e total', async () => {
  const reserva = { ...dadosReserva, salaId };
  const r = await requisicao('/api/reservas', 'POST', reserva);
  assert.equal(r.status, 201);
  reservaId = r.resultado.id;
  assert.equal((await requisicao(`/api/reservas/${reservaId}`)).resultado.aluno, reserva.aluno);
  for (const [inicio, fim] of [['08:00','09:30'], ['09:30','10:00'], ['10:00','11:00'], ['09:00','10:30']]) {
    const conflito = await requisicao('/api/reservas', 'POST', { ...reserva, inicio, fim });
    assert.equal(conflito.status, 409, `${inicio} - ${fim}`);
    assert.match(conflito.resultado.erro, /Conflito/);
  }
});

test('Reservas em horários adjacentes, datas ou salas diferentes são aceitas', async () => {
  const sala2 = await requisicao('/api/salas', 'POST', { ...dadosSala, nome: 'Biblioteca' });
  const casos = [
    { inicio: '10:30', fim: '11:30' },
    { data: '2026-11-21' },
    { salaId: sala2.resultado.id }
  ];
  for (const caso of casos) {
    const r = await requisicao('/api/reservas', 'POST', { ...dadosReserva, salaId, ...caso });
    assert.equal(r.status, 201);
  }
});

test('Filtro de reservas por data, sala e status funciona', async () => {
  const r = await requisicao(`/api/reservas?data=2026-11-20&salaId=${salaId}&status=Ativa`);
  assert.equal(r.status, 200);
  assert.equal(r.resultado.length, 2);
});

test('Editar reserva não cria conflito consigo mesma; conflito com outra é bloqueado', async () => {
  const r = await requisicao(`/api/reservas/${reservaId}`, 'PUT', { ...dadosReserva, salaId, finalidade: 'Outra finalidade' });
  assert.equal(r.status, 200);
  const falha = await requisicao(`/api/reservas/${reservaId}`, 'PUT', { ...dadosReserva, salaId, inicio:'10:30', fim:'11:30' });
  assert.equal(falha.status, 409);
});

test('Cancelar uma reserva libera o intervalo para nova reserva ativa', async () => {
  const cancelar = await requisicao(`/api/reservas/${reservaId}`, 'PUT', { ...dadosReserva, salaId, status: 'Cancelada' });
  assert.equal(cancelar.status, 200);
  const r = await requisicao('/api/reservas', 'POST', { ...dadosReserva, salaId });
  assert.equal(r.status, 201);
});

test('Salas inativas não aceitam novas reservas ativas', async () => {
  const novaSala = await requisicao('/api/salas', 'POST', { ...dadosSala, nome: 'Sala Fechada', situacao:'Inativa' });
  assert.equal((await requisicao('/api/reservas','POST',{...dadosReserva,salaId:novaSala.resultado.id})).status,409);
  assert.equal((await requisicao('/api/reservas','POST',{...dadosReserva,salaId:novaSala.resultado.id,status:'Cancelada'})).status,409);
});

test('Não é possível excluir uma sala com reserva vinculada, mesmo cancelada', async () => {
  const r = await requisicao(`/api/salas/${salaId}`, 'DELETE');
  assert.equal(r.status, 409);
  const baixa = await requisicao(`/api/salas/${salaId}`, 'PUT', { ...dadosSala, capacidade: 2 });
  assert.equal(baixa.status, 409);
});

test('Sala pode ser atualizada; reserva pode ser excluída', async () => {
  const salaLivre = await requisicao('/api/salas', 'POST', { ...dadosSala, nome: 'Sala Temporária' });
  assert.equal((await requisicao(`/api/salas/${salaLivre.resultado.id}`, 'PUT', { ...dadosSala, nome: 'Sala Alterada' })).status, 200);
  assert.equal((await requisicao(`/api/salas/${salaLivre.resultado.id}`, 'DELETE')).status, 200);
  assert.equal((await requisicao(`/api/salas/${salaLivre.resultado.id}`)).status, 404);
  assert.equal((await requisicao(`/api/reservas/${reservaId}`, 'DELETE')).status, 200);
  assert.equal((await requisicao(`/api/reservas/${reservaId}`)).status, 404);
});

test('Feriado nacional retorna data e descrição sem bloquear o agendamento', async () => {
  const resultado = await requisicao('/api/feriados/2026');
  assert.equal(resultado.status, 200);
  assert.equal(resultado.resultado[0].date, '2026-11-20');
});

test('Rotas inexistentes e métodos inválidos possuem HTTP correto', async () => {
  assert.equal((await requisicao('/api/inexistente')).status, 404);
  assert.equal((await requisicao('/api/salas', 'DELETE')).status, 405);
  assert.equal((await requisicao('/api/salas/999')).status, 404);
  assert.equal((await requisicao('/api/reservas/999')).status, 404);
});

test('Os dados permanecem em JSON após reiniciar o servidor', async () => {
  const totalSalas = (await requisicao('/api/salas')).resultado.length;
  const totalReservas = (await requisicao('/api/reservas')).resultado.length;
  await parar();
  await iniciar();
  assert.equal((await requisicao('/api/salas')).resultado.length, totalSalas);
  assert.equal((await requisicao('/api/reservas')).resultado.length, totalReservas);
});

test('Falha da BrasilAPI devolve 502 e não impede acesso à API interna', async () => {
  await parar();
  servidor = criarServidor({ arquivoBanco, buscarFeriados: async () => { throw new Error('Serviço indisponível'); } });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  endereco = `http://127.0.0.1:${servidor.address().port}`;
  const r = await requisicao('/api/feriados/2026');
  assert.equal(r.status, 502);
  assert.match(r.resultado.erro, /continuar/);
  assert.equal((await requisicao('/api/salas')).status, 200);
});
