import iconUrl from '../../assets/icon.svg';

export default function App() {
  return (
    <div className="page">
      <header className="header">
        <img className="header-icon" src={iconUrl} alt="" width={36} height={36} />
        <h1 className="header-title">Glider</h1>
        <span className="header-sub">Settings</span>
        <span className="header-account">Not logged in</span>
      </header>
      <footer className="footer">
        <span>
          Glider sends from your own Telegram account. Your login stays on this computer.
        </span>
      </footer>
    </div>
  );
}
