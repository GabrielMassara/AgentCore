<div align="right">

[🇺🇸 Read in English](README.en.md)

</div>

<div align="center">

<pre>                                                       
                                                          
▄████▄  ▄▄▄▄ ▄▄▄▄▄ ▄▄  ▄▄ ▄▄▄▄▄▄ ▄█████  ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ 
██▄▄██ ██ ▄▄ ██▄▄  ███▄██   ██   ██     ██▀██ ██▄█▄ ██▄▄  
██  ██ ▀███▀ ██▄▄▄ ██ ▀██   ██   ▀█████ ▀███▀ ██ ██ ██▄▄▄ 
</pre>

**Um adaptador leve em TypeScript que expõe agentes de IA como uma API HTTP unificada.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![Claude Agent SDK](https://img.shields.io/badge/Claude_Agent_SDK-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Codex SDK](https://img.shields.io/badge/Codex_SDK-000000?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iI2ZmZiIgdmlld0JveD0iMCAwIDE2IDE2Ij4KICA8cGF0aCBkPSJNMTQuOTQ5IDYuNTQ3YTMuOTQgMy45NCAwIDAgMC0uMzQ4LTMuMjczIDQuMTEgNC4xMSAwIDAgMC00LjQtMS45MzRBNC4xIDQuMSAwIDAgMCA4LjQyMy4yIDQuMTUgNC4xNSAwIDAgMCA2LjMwNS4wODZhNC4xIDQuMSAwIDAgMC0xLjg5MS45NDggNC4wNCA0LjA0IDAgMCAwLTEuMTU4IDEuNzUzIDQuMSA0LjEgMCAwIDAtMS41NjMuNjc5QTQgNCAwIDAgMCAuNTU0IDQuNzJhMy45OSAzLjk5IDAgMCAwIC41MDIgNC43MzEgMy45NCAzLjk0IDAgMCAwIC4zNDYgMy4yNzQgNC4xMSA0LjExIDAgMCAwIDQuNDAyIDEuOTMzYy4zODIuNDI1Ljg1Mi43NjQgMS4zNzcuOTk1LjUyNi4yMzEgMS4wOTUuMzUgMS42Ny4zNDYgMS43OC4wMDIgMy4zNTgtMS4xMzIgMy45MDEtMi44MDRhNC4xIDQuMSAwIDAgMCAxLjU2My0uNjggNCA0IDAgMCAwIDEuMTQtMS4yNTMgMy45OSAzLjk5IDAgMCAwLS41MDYtNC43MTZtLTYuMDk3IDguNDA2YTMuMDUgMy4wNSAwIDAgMS0xLjk0NS0uNjk0bC4wOTYtLjA1NCAzLjIzLTEuODM4YS41My41MyAwIDAgMCAuMjY1LS40NTV2LTQuNDlsMS4zNjYuNzc4cS4wMi4wMTEuMDI1LjAzNXYzLjcyMmMtLjAwMyAxLjY1My0xLjM2MSAyLjk5Mi0zLjAzNyAyLjk5Nm0tNi41My0yLjc1YTIuOTUgMi45NSAwIDAgMS0uMzYtMi4wMWwuMDk1LjA1N0w1LjI5IDEyLjA5YS41My41MyAwIDAgMCAuNTI3IDBsMy45NDktMi4yNDZ2MS41NTVhLjA1LjA1IDAgMCAxLS4wMjIuMDQxTDYuNDczIDEzLjNjLTEuNDU0LjgyNi0zLjMxMS4zMzUtNC4xNS0xLjA5OG0tLjg1LTYuOTRBMy4wMiAzLjAyIDAgMCAxIDMuMDcgMy45NDl2My43ODVhLjUxLjUxIDAgMCAwIC4yNjIuNDUxbDMuOTMgMi4yMzctMS4zNjYuNzc5YS4wNS4wNSAwIDAgMS0uMDQ4IDBMMi41ODUgOS4zNDJhMi45OCAyLjk4IDAgMCAxLTEuMTEzLTQuMDk0em0xMS4yMTYgMi41NzFMOC43NDcgNS41NzZsMS4zNjItLjc3NmEuMDUuMDUgMCAwIDEgLjA0OCAwbDMuMjY1IDEuODZhMyAzIDAgMCAxIDEuMTczIDEuMjA3IDIuOTYgMi45NiAwIDAgMS0uMjcgMy4yIDMuMDUgMy4wNSAwIDAgMS0xLjM2Ljk5N1Y4LjI3OWEuNTIuNTIgMCAwIDAtLjI3Ni0uNDQ1bTEuMzYtMi4wMTUtLjA5Ny0uMDU3LTMuMjI2LTEuODU1YS41My41MyAwIDAgMC0uNTMgMEw2LjI0OSA2LjE1M1Y0LjU5OGEuMDQuMDQgMCAwIDEgLjAxOS0uMDRMOS41MzMgMi43YTMuMDcgMy4wNyAwIDAgMSAzLjI1Ny4xMzljLjQ3NC4zMjUuODQzLjc3OCAxLjA2NiAxLjMwMy4yMjMuNTI2LjI4OSAxLjEwMy4xOTEgMS42NjR6TTUuNTAzIDguNTc1IDQuMTM5IDcuOGEuMDUuMDUgMCAwIDEtLjAyNi0uMDM3VjQuMDQ5YzAtLjU3LjE2Ni0xLjEyNy40NzYtMS42MDdzLjc1Mi0uODY0IDEuMjc1LTEuMTA1YTMuMDggMy4wOCAwIDAgMSAzLjIzNC40MWwtLjA5Ni4wNTQtMy4yMyAxLjgzOGEuNTMuNTMgMCAwIDAtLjI2NS40NTV6bS43NDItMS41NzcgMS43NTgtMSAxLjc2MiAxdjJsLTEuNzU1IDEtMS43NjItMXoiLz4KPC9zdmc+Cg==)
![OpenCode](https://img.shields.io/badge/OpenCode-000000?style=for-the-badge&logo=opencode&logoColor=white)

</div>

<p align="center">
  <a href="https://gabrielmassara.com/projetos/AgentCore/" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/badge/Abrir%20site%20do%20projeto-0078D4?style=for-the-badge" alt="Abrir site do projeto">
  </a>
</p>

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

## Runtimes

- **Claude Code**: implementado (`ClaudeRuntime`, via `@anthropic-ai/claude-agent-sdk`).
- **Codex**: implementado (`CodexRuntime`, via `@openai/codex-sdk`).
- **OpenCode**: implementado (`OpenCodeRuntime`, via `@opencode-ai/sdk`).

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
