# Sistema de Reserva de Salas – CRUD + API

Projeto de Desenvolvimento Web III para gerenciar salas de estudo, laboratórios e reservas acadêmicas.

**Tecnologias:** Node.js, NPM, HTML, CSS, JavaScript e arquivo JSON. Não foi utilizado Express ou outro framework.

## 1. Como executar

1. Extraia o ZIP e abra a pasta `Projeto_Reserva_Salas_CRUD` no VS Code.
2. Verifique se o Node.js 20 ou superior está instalado com `node -v`.
3. Abra o terminal dentro da pasta e execute:

   ```bash
   npm install
   npm start
   ```

4. Abra `http://localhost:5000` no navegador.

Não há dependências externas no `package.json`, então `npm install` só prepara o projeto. Também é possível iniciar diretamente com `node app.js`.

Para parar o servidor: `Ctrl + C`.

Se a porta 5000 estiver ocupada, altere a porta no terminal:

- PowerShell: `$env:PORT=3000; npm start`
- Prompt de Comando: `set PORT=3000 && npm start`

## 2. Arquivos principais

```text
Projeto_Reserva_Salas_CRUD/
├── app.js                 # Servidor HTTP, rotas e validações
├── database.js            # Leitura e gravação do arquivo JSON
├── package.json           # Scripts NPM
├── .gitignore             # Ignora dados locais e node_modules
├── README.md              # Orientações do projeto
├── data/
│   └── exemplo.json      # Estrutura inicial vazia do banco
├── public/
│   ├── index.html         # Interface do sistema
│   ├── style.css          # Estilos visuais
│   └── script.js          # fetch(), formulários e pesquisas
└── testes/
    └── api.test.js        # Testes automáticos da API
```

**Persistência:** o arquivo `data/banco.json` será criado na primeira execução. Esse arquivo mantém as salas e reservas mesmo depois que o servidor é reiniciado e está no `.gitignore` para não publicar dados pessoais de alunos. Não apague o arquivo se quiser manter os cadastros.

## 3. Cadastros

### Salas

- ID automático;
- Nome ou identificação;
- Localização;
- Capacidade máxima (número inteiro maior que zero);
- Recursos disponíveis (separados por vírgulas no formulário);
- Situação: `Disponível` ou `Inativa`.

### Reservas

- ID automático;
- Nome e e-mail do aluno;
- ID da sala selecionada;
- Data (`AAAA-MM-DD`);
- Horário inicial e final (`HH:MM`);
- Quantidade de participantes;
- Finalidade;
- Status: `Ativa` ou `Cancelada`.

## 4. Regras de negócio

1. Uma reserva **Ativa** não pode coincidir com outra reserva ativa na mesma sala e data. Se uma reserva for de `09:00` até `10:00`, outra poderá começar às `10:00`.
2. O horário final precisa ser posterior ao inicial.
3. A quantidade de participantes não pode superar a capacidade da sala.
4. Salas inativas não aceitam novas reservas ativas. Reservas anteriores permanecem cadastradas.
5. Não é possível excluir sala com reservas vinculadas, mesmo quando canceladas. Para excluir a sala, é necessário excluir as reservas primeiro.
6. Uma reserva cancelada deixa o horário livre para novas reservas ativas.
7. Ao editar uma sala, não é permitido diminuir sua capacidade abaixo dos participantes de uma reserva ativa já cadastrada.
8. O sistema não bloqueia reservas em feriados nacionais: ele apenas mostra um aviso.

## 5. Endpoints REST

| Método | Endereço | Função |
|---|---|---|
| GET | `/api/salas` | Lista todas as salas |
| GET | `/api/salas/:id` | Consulta uma sala por ID |
| POST | `/api/salas` | Cadastra sala |
| PUT | `/api/salas/:id` | Edita sala |
| DELETE | `/api/salas/:id` | Exclui sala |
| GET | `/api/reservas` | Lista reservas |
| GET | `/api/reservas/:id` | Consulta reserva por ID |
| POST | `/api/reservas` | Cadastra reserva |
| PUT | `/api/reservas/:id` | Edita reserva |
| DELETE | `/api/reservas/:id` | Exclui reserva |
| GET | `/api/feriados/:ano` | Consulta os feriados nacionais pela BrasilAPI |

O `GET /api/reservas` aceita filtros opcionais: `?data=2026-11-20&salaId=1&status=Ativa`.

**Status HTTP utilizados:** `200` (consulta, edição e exclusão), `201` (criação), `400` (dados inválidos), `404` (recurso/rota não encontrado), `405` (método não permitido), `409` (conflito de horários, limite de capacidade, sala inativa ou exclusão bloqueada), `413` (corpo de requisição muito grande) e `502` (falha na BrasilAPI). As respostas das rotas da API são em JSON.

### Exemplo de corpo JSON para cadastrar sala

```json
{
  "nome": "Laboratório 01",
  "localizacao": "Bloco A, 2º andar",
  "capacidade": 20,
  "recursos": ["Computadores", "Projetor", "Wi-Fi"],
  "situacao": "Disponível"
}
```

### Exemplo de corpo JSON para cadastrar reserva

```json
{
  "aluno": "Aluno Exemplo",
  "email": "aluno@exemplo.com",
  "salaId": 1,
  "data": "2026-11-20",
  "inicio": "14:00",
  "fim": "15:00",
  "participantes": 4,
  "finalidade": "Trabalho em grupo",
  "status": "Ativa"
}
```

O exemplo considera que a sala de ID 1 já foi cadastrada.

## 6. API de feriados nacionais

A tela consulta o servidor local em `/api/feriados/2026`. Esse servidor chama a BrasilAPI em:

`https://brasilapi.com.br/api/feriados/v1/2026`

A aplicação mostra um aviso se a data selecionada aparecer no retorno. Mesmo em feriados, o botão de salvar continua disponível. Se faltar internet ou a BrasilAPI não responder, aparece uma mensagem informativa e o cadastro manual continua funcionando.

Documentação: https://brasilapi.com.br/docs

**Observação:** o retorno da API inclui datas que a BrasilAPI classifica como feriados nacionais. A aplicação exibe essa informação, sem afirmar que a instituição estará aberta ou fechada.

## 7. Como testar para apresentar

1. Cadastre a sala **Laboratório 01**, capacidade **10**, situação **Disponível**.
2. Crie uma reserva ativa no dia **20/11/2026**, das **09:00 às 10:00**, para **4 pessoas**. A data é usada para demonstrar o aviso da BrasilAPI.
3. Tente outra reserva ativa na mesma sala e dia, das **09:30 às 10:30**. O sistema deve mostrar erro de **conflito de horário**.
4. Tente agendar **12 participantes** na sala de capacidade 10. O sistema deve impedir.
5. Faça uma reserva das **10:00 às 11:00**. Ela pode ser criada, pois não se sobrepõe à de 09:00 às 10:00.
6. Cancele uma reserva para verificar se o intervalo fica disponível novamente.
7. Tente excluir a sala com reservas vinculadas. O sistema deve impedir.
8. Use os filtros da página de reservas para buscar por **data**, **sala** e **status**.
9. Encerre o servidor e execute `npm start` novamente. Os registros devem continuar salvos.

## 8. Executar os testes automáticos

```bash
npm test
```

Os testes cobrem CRUD, validações, conflito entre horários, filtros, bloqueio de exclusão, persistência após reinício e retorno da API externa simulada. **Eles não substituem a verificação visual no navegador nem a consulta real à BrasilAPI**, que dependem do seu ambiente e da internet.

## 9. Enviar ao GitHub

O arquivo `data/banco.json` fica fora do repositório por estar listado no `.gitignore`. O arquivo `data/exemplo.json` é enviado para que o projeto possa inicializar normalmente no computador do professor.

Antes de publicar, verifique se não existem dados pessoais reais nos arquivos que serão enviados.

```bash
git init
git add .
git commit -m "Sistema de reserva de salas CRUD e API REST"
git branch -M main
```

Crie um repositório **vazio** no GitHub (sem README automático), copie a URL HTTPS e execute:

```bash
git remote add origin URL_DO_REPOSITORIO
git push -u origin main
```
