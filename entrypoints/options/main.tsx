import React from 'react';
import ReactDOM from 'react-dom/client';
import { connectInMemory } from '../../lib/login/connection';
import { createLoginService } from '../../lib/login/service';
import { createFakeAuth } from '../../lib/telegram/fake';
import App from './App';
import './style.css';

const connection = connectInMemory(
  createLoginService(createFakeAuth({ scenario: 'default' }), 'Chromium on Linux'),
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App connection={connection} />
  </React.StrictMode>,
);
