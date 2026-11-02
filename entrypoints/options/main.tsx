import React from 'react';
import ReactDOM from 'react-dom/client';
import { connectLogin } from '../../lib/login/connection';
import { connectChats } from '../../lib/target-chat';
import App from './App';
import '../../components/base.css';
import './style.css';

const scenario =
  import.meta.env.WXT_TELEGRAM === 'fake'
    ? (new URLSearchParams(location.search).get('fake') ?? undefined)
    : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App connection={connectLogin({ scenario })} chats={connectChats()} />
  </React.StrictMode>,
);
