import { EventEmitter } from 'events';
import { AgentEvent } from './agent-event';

// Um único EventEmitter para toda a aplicação. Cada sessão usa seu próprio
// canal dentro dele. o nome do evento do EventEmitter é o sessionId.
const emitter = new EventEmitter();

// Nao tem limite de listeners. cada cliente SSE conectado a uma sessão vira um listener
emitter.setMaxListeners(0);

// Publica um evento para quem estiver ouvindo a sessão dele 
export function publish(event: AgentEvent) {
  emitter.emit(event.sessionId, event);
}

// Registra um listener para os eventos de uma sessão especifica
export function subscribe(sessionId: string, listener: (event: AgentEvent) => void) {
  emitter.on(sessionId, listener);
}

// Remove um listener registrado com subscribe. Deve ser chamado quando o
// cliente SSE desconecta para não vazar listeners
export function unsubscribe(sessionId: string, listener: (event: AgentEvent) => void) {
  emitter.off(sessionId, listener);
}
