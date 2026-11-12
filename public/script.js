// Comunicação com a API e atualização das páginas do sistema.
const $ = (seletor) => document.querySelector(seletor);
let salas = [];
let reservas = [];
let avisoTemporizador;
let requisicaoFeriado = 0;

function escapar(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mensagem(texto, tipo = 'sucesso') {
  const elemento = $('#aviso');
  elemento.className = `aviso ${tipo}`;
  elemento.textContent = texto;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  clearTimeout(avisoTemporizador);
  avisoTemporizador = setTimeout(() => elemento.classList.add('oculto'), 6500);
}
async function pedir(url, opcoes = {}) {
  let resposta;
  try { resposta = await fetch(url, opcoes); }
  catch { throw new Error('Não foi possível conectar ao servidor. Verifique se o Node.js está ligado.'); }
  let dados;
  try { dados = await resposta.json(); }
  catch { throw new Error('O servidor enviou uma resposta inesperada.'); }
  if (!resposta.ok) throw new Error(dados.erro || `Erro HTTP ${resposta.status}`);
  return dados;
}
function dadosJson(objeto, metodo) {
  return { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(objeto) };
}
function exibirPagina(nome) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.add('oculto'));
  $(`#pagina-${nome}`).classList.remove('oculto');
  document.querySelectorAll('.menu').forEach(b => b.classList.toggle('ativo', b.dataset.pagina === nome));
  $('#aviso').classList.add('oculto');
  if (nome === 'reservas') carregarReservas().catch(e => mensagem(e.message, 'erro'));
}
function dataBR(data) {
  const partes = String(data).split('-');
  return partes.length === 3 ? partes.reverse().join('/') : data;
}
function salaPorId(id) {
  return salas.find(sala => sala.id === Number(id));
}
async function carregarTudo() {
  salas = await pedir('/api/salas');
  reservas = await pedir('/api/reservas');
  atualizarResumo();
  atualizarSeletoresSala();
  listarSalas();
  listarReservas();
}
function atualizarResumo() {
  $('#total-salas').textContent = salas.length;
  $('#total-disponiveis').textContent = salas.filter(s => s.situacao === 'Disponível').length;
  $('#total-reservas').textContent = reservas.filter(r => r.status === 'Ativa').length;
}
function atualizarSeletoresSala() {
  const valorForm = $('#sala-reserva').value;
  const valorFiltro = $('#filtro-sala').value;
  // Mantemos salas inativas na seleção para permitir editar reservas antigas.
  $('#sala-reserva').innerHTML = '<option value="">Selecione uma sala</option>' +
    salas.map(s => `<option value="${s.id}">${escapar(s.nome)}${s.situacao === 'Inativa' ? ' (Inativa)' : ''}</option>`).join('');
  $('#filtro-sala').innerHTML = '<option value="">Todas as salas</option>' +
    salas.map(s => `<option value="${s.id}">${escapar(s.nome)}</option>`).join('');
  $('#sala-reserva').value = valorForm;
  $('#filtro-sala').value = valorFiltro;
}
function listarSalas() {
  const busca = $('#pesquisa-salas').value.trim().toLowerCase();
  const lista = salas.filter(s => s.nome.toLowerCase().includes(busca));
  $('#numero-salas').textContent = `${lista.length} sala(s)`;
  $('#lista-salas').innerHTML = lista.length ? lista.map(s => `
    <tr>
      <td><strong>${escapar(s.nome)}</strong><small>${escapar(s.localizacao)}</small></td>
      <td>${s.capacidade} pessoas</td>
      <td><div class="recursos">${s.recursos.length ? escapar(s.recursos.join(', ')) : 'Não informado'}</div></td>
      <td><span class="etiqueta ${s.situacao === 'Disponível' ? 'disponivel' : 'inativa'}">${escapar(s.situacao)}</span></td>
      <td><div class="acoes"><button class="botao pequeno borda" data-acao="editar-sala" data-id="${s.id}">Editar</button><button class="botao pequeno perigo" data-acao="excluir-sala" data-id="${s.id}">Excluir</button></div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="vazio">Nenhuma sala encontrada.</td></tr>';
}
function limparSala() {
  $('#form-sala').reset();
  $('#form-sala').elements.id.value = '';
  $('#titulo-form-sala').textContent = 'Nova sala';
  $('#salvar-sala').textContent = 'Cadastrar sala';
}
async function editarSala(id) {
  const s = await pedir(`/api/salas/${id}`);
  const form = $('#form-sala');
  for (const campo of ['id', 'nome', 'localizacao', 'capacidade', 'situacao']) form.elements[campo].value = s[campo];
  form.elements.recursos.value = s.recursos.join(', ');
  $('#titulo-form-sala').textContent = 'Editar sala';
  $('#salvar-sala').textContent = 'Salvar alterações';
  exibirPagina('salas');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function salvarSala(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const id = form.elements.id.value;
  const sala = {
    nome: form.elements.nome.value, localizacao: form.elements.localizacao.value,
    capacidade: Number(form.elements.capacidade.value),
    situacao: form.elements.situacao.value, recursos: form.elements.recursos.value
  };
  try {
    await pedir(id ? `/api/salas/${id}` : '/api/salas', dadosJson(sala, id ? 'PUT' : 'POST'));
    limparSala();
    await carregarTudo();
    mensagem(id ? 'Sala atualizada com sucesso!' : 'Sala cadastrada com sucesso!');
  } catch (e) { mensagem(e.message, 'erro'); }
}
async function excluirSala(id) {
  const sala = salaPorId(id);
  if (!confirm(`Deseja excluir a sala "${sala.nome}"?`)) return;
  try {
    await pedir(`/api/salas/${id}`, { method: 'DELETE' });
    limparSala();
    await carregarTudo();
    mensagem('Sala excluída com sucesso!');
  } catch (e) { mensagem(e.message, 'erro'); }
}
async function carregarReservas() {
  const parametros = new URLSearchParams();
  const data = $('#filtro-data').value;
  const salaId = $('#filtro-sala').value;
  const status = $('#filtro-status').value;
  if (data) parametros.set('data', data);
  if (salaId) parametros.set('salaId', salaId);
  if (status) parametros.set('status', status);
  const filtro = parametros.toString();
  const lista = await pedir('/api/reservas' + (filtro ? `?${filtro}` : ''));
  listarReservas(lista);
}
function listarReservas(lista = reservas) {
  $('#numero-reservas').textContent = `${lista.length} reserva(s)`;
  $('#lista-reservas').innerHTML = lista.length ? lista.map(r => {
    const sala = salaPorId(r.salaId);
    const nomeSala = sala ? sala.nome : `Sala #${r.salaId}`;
    return `<tr>
      <td><strong>${escapar(r.aluno)}</strong><small>${escapar(r.finalidade)}</small><small>${escapar(r.email)}</small></td>
      <td>${escapar(nomeSala)}</td><td>${escapar(dataBR(r.data))}<small>${escapar(r.inicio)} às ${escapar(r.fim)}</small></td>
      <td>${r.participantes}</td><td><span class="etiqueta ${r.status === 'Ativa' ? 'ativa' : 'cancelada'}">${escapar(r.status)}</span></td>
      <td><div class="acoes"><button class="botao pequeno borda" data-acao="editar-reserva" data-id="${r.id}">Editar</button>
      ${r.status === 'Ativa' ? `<button class="botao pequeno cancelar" data-acao="cancelar-reserva-status" data-id="${r.id}">Cancelar</button>` : ''}
      <button class="botao pequeno perigo" data-acao="excluir-reserva" data-id="${r.id}">Excluir</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="vazio">Nenhuma reserva encontrada para os filtros escolhidos.</td></tr>';
}
function limparReserva() {
  $('#form-reserva').reset();
  $('#form-reserva').elements.id.value = '';
  $('#titulo-form-reserva').textContent = 'Nova reserva';
  $('#salvar-reserva').textContent = 'Cadastrar reserva';
  requisicaoFeriado++;
  $('#aviso-feriado').className = 'feriado neutro';
  $('#aviso-feriado').textContent = 'Selecione a data para verificar feriados nacionais.';
}
async function editarReserva(id) {
  const r = await pedir(`/api/reservas/${id}`);
  const form = $('#form-reserva');
  for (const campo of ['id', 'aluno', 'email', 'salaId', 'data', 'inicio', 'fim', 'participantes', 'finalidade', 'status']) {
    form.elements[campo].value = r[campo];
  }
  $('#titulo-form-reserva').textContent = 'Editar reserva';
  $('#salvar-reserva').textContent = 'Salvar alterações';
  exibirPagina('reservas');
  verificarFeriado();
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function salvarReserva(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const id = form.elements.id.value;
  const reserva = {
    aluno: form.elements.aluno.value, email: form.elements.email.value,
    salaId: Number(form.elements.salaId.value), data: form.elements.data.value,
    inicio: form.elements.inicio.value, fim: form.elements.fim.value,
    participantes: Number(form.elements.participantes.value),
    finalidade: form.elements.finalidade.value, status: form.elements.status.value
  };
  try {
    await pedir(id ? `/api/reservas/${id}` : '/api/reservas', dadosJson(reserva, id ? 'PUT' : 'POST'));
    limparReserva();
    await carregarTudo();
    await carregarReservas();
    mensagem(id ? 'Reserva atualizada com sucesso!' : 'Reserva cadastrada com sucesso!');
  } catch (e) { mensagem(e.message, 'erro'); }
}
async function cancelarReservaStatus(id) {
  if (!confirm('Deseja cancelar esta reserva?')) return;
  try {
    const r = await pedir(`/api/reservas/${id}`);
    await pedir(`/api/reservas/${id}`, dadosJson({ ...r, status: 'Cancelada' }, 'PUT'));
    await carregarTudo();
    await carregarReservas();
    mensagem('Reserva cancelada. O horário ficou livre para novos agendamentos.');
  } catch (e) { mensagem(e.message, 'erro'); }
}
async function excluirReserva(id) {
  if (!confirm('Deseja excluir esta reserva permanentemente?')) return;
  try {
    await pedir(`/api/reservas/${id}`, { method: 'DELETE' });
    await carregarTudo();
    await carregarReservas();
    limparReserva();
    mensagem('Reserva excluída com sucesso!');
  } catch (e) { mensagem(e.message, 'erro'); }
}
async function verificarFeriado() {
  const data = $('#data-reserva').value;
  const numero = ++requisicaoFeriado;
  const aviso = $('#aviso-feriado');
  aviso.className = 'feriado neutro';
  if (!data) { aviso.textContent = 'Selecione a data para verificar feriados nacionais.'; return; }
  aviso.textContent = 'Consultando feriados nacionais...';
  try {
    const feriados = await pedir(`/api/feriados/${data.slice(0, 4)}`);
    if (numero !== requisicaoFeriado) return;
    const encontrado = feriados.find(f => f.date === data);
    aviso.className = `feriado ${encontrado ? 'alerta' : 'ok'}`;
    aviso.textContent = encontrado
      ? `Atenção: ${dataBR(data)} consta na BrasilAPI como "${encontrado.name}". A reserva continua permitida.`
      : 'Nenhum feriado nacional retornado para esta data. A reserva pode continuar.';
  } catch (e) {
    if (numero !== requisicaoFeriado) return;
    aviso.className = 'feriado erro';
    aviso.textContent = 'Não foi possível verificar feriados agora. Você pode continuar a reserva manualmente.';
  }
}

document.querySelectorAll('[data-pagina]').forEach(botao => botao.addEventListener('click', () => exibirPagina(botao.dataset.pagina)));
$('#form-sala').addEventListener('submit', salvarSala);
$('#form-reserva').addEventListener('submit', salvarReserva);
$('#cancelar-sala').addEventListener('click', limparSala);
$('#cancelar-reserva').addEventListener('click', limparReserva);
$('#pesquisa-salas').addEventListener('input', listarSalas);
$('#data-reserva').addEventListener('change', verificarFeriado);
for (const seletor of ['#filtro-data', '#filtro-sala', '#filtro-status']) {
  $(seletor).addEventListener('change', () => carregarReservas().catch(e => mensagem(e.message, 'erro')));
}
$('#limpar-filtros').addEventListener('click', () => {
  for (const seletor of ['#filtro-data', '#filtro-sala', '#filtro-status']) $(seletor).value = '';
  carregarReservas().catch(e => mensagem(e.message, 'erro'));
});
document.body.addEventListener('click', async evento => {
  const botao = evento.target.closest('[data-acao]');
  if (!botao) return;
  const id = Number(botao.dataset.id);
  const acao = botao.dataset.acao;
  try {
    if (acao === 'editar-sala') await editarSala(id);
    if (acao === 'excluir-sala') await excluirSala(id);
    if (acao === 'editar-reserva') await editarReserva(id);
    if (acao === 'cancelar-reserva-status') await cancelarReservaStatus(id);
    if (acao === 'excluir-reserva') await excluirReserva(id);
  } catch (e) { mensagem(e.message, 'erro'); }
});
carregarTudo().catch(e => mensagem(e.message, 'erro'));
