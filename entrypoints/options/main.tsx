import React from 'react';
import ReactDOM from 'react-dom/client';
import { connectChats } from '../../lib/chats/connection';
import { connectPort, type LoginConnection } from '../../lib/login/connection';
import App from './App';
import './style.css';

function connect(): LoginConnection {
  const port = connectPort();
  if (import.meta.env.WXT_TELEGRAM !== 'fake') return port;
  const fake = new URLSearchParams(location.search).get('fake') ?? undefined;
  return {
    ...port,
    send: (command) => port.send(command.type === 'hello' ? { ...command, fake } : command),
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App connection={connect()} chats={connectChats()} />
  </React.StrictMode>,
);
