const fs = require('node:fs');
const path = require('node:path');

function abrirBanco(arquivo = path.join(__dirname, 'data', 'banco.json')) {
  const pasta = path.dirname(arquivo);
  fs.mkdirSync(pasta, { recursive: true });

  if (!fs.existsSync(arquivo)) {
    fs.copyFileSync(path.join(__dirname, 'data', 'exemplo.json'), arquivo);
  }

  const banco = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!Array.isArray(banco.salas) || !Array.isArray(banco.reservas)) {
    throw new Error('O arquivo do banco de dados está inválido.');
  }
  banco.proximoIdSala = Number(banco.proximoIdSala) || 1;
  banco.proximoIdReserva = Number(banco.proximoIdReserva) || 1;

  function salvar() {
    const temporario = `${arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(banco, null, 2), 'utf8');
    fs.renameSync(temporario, arquivo);
  }

  return { banco, salvar };
}

module.exports = { abrirBanco };
