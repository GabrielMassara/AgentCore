<div align="right">

[🇺🇸 Read in English](README.en.md)

</div>

<div align="center">

```
                                                          
                                                          
▄████▄  ▄▄▄▄ ▄▄▄▄▄ ▄▄  ▄▄ ▄▄▄▄▄▄ ▄█████  ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ 
██▄▄██ ██ ▄▄ ██▄▄  ███▄██   ██   ██     ██▀██ ██▄█▄ ██▄▄  
██  ██ ▀███▀ ██▄▄▄ ██ ▀██   ██   ▀█████ ▀███▀ ██ ██ ██▄▄▄ 
```

**Um adaptador leve em TypeScript que expõe agentes de IA como uma API HTTP unificada.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![Claude Agent SDK](https://img.shields.io/badge/Claude_Agent_SDK-D97757?style=for-the-badge&logo=anthropic&logoColor=white)

</div>

---

## O que é

Cada agente de IA de codificação (Claude Code, Codex, OpenCode) tem sua própria SDK, seu
próprio jeito de gerenciar sessão e seu próprio formato de mensagem. Uma aplicação cliente que
queira suportar mais de um acaba tendo que falar um protocolo diferente para cada um.

**AgentCore** resolve isso ficando no meio: é uma API HTTP local, que roda na própria máquina
do usuário, e expõe qualquer agente de IA
por trás de um único contrato HTTP e SSE. O cliente cria sessões, envia mensagens e escuta
eventos sempre da mesma forma, não importa qual runtime está processando por baixo.

O ponto central da arquitetura é manter separado o `id` da sessão do Adapter e o
`providerSessionId` gerado pelo runtime de IA. Isso permite que o Adapter troque, resuma ou
combine runtimes diferentes sem que o cliente precise saber como cada SDK funciona por dentro.

## Como rodar

### Pré-requisitos

Node.js 18+ e autenticação com o Claude configurada na máquina (Claude Code CLI logado).

### Instalação

```bash
npm install
```

### Desenvolvimento

```bash
npm run dev
```

A API sobe em `http://localhost:3000`.

### Build de produção

```bash
npm run build
npm start
```
