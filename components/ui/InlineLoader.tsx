export default function InlineLoader() {
  return (
    <>
      <style>{`
        .dot-wave {
          --uib-size: 40px;
          --uib-speed: 0.6s;
          --uib-color: var(--accent, #0d0909);
          display: flex;
          flex-flow: row nowrap;
          align-items: center;
          justify-content: space-between;
          width: var(--uib-size);
          height: calc(var(--uib-size) * 0.17);
          padding-top: calc(var(--uib-size) * 0.34);
        }

        .dot-wave__dot {
          flex-shrink: 0;
          width: calc(var(--uib-size) * 0.17);
          height: calc(var(--uib-size) * 0.17);
          border-radius: 50%;
          background-color: var(--uib-color);
          will-change: transform;
        }

        .dot-wave__dot:nth-child(1) { animation: dw-jump var(--uib-speed) ease-in-out calc(var(--uib-speed) * -0.45) infinite; }
        .dot-wave__dot:nth-child(2) { animation: dw-jump var(--uib-speed) ease-in-out calc(var(--uib-speed) * -0.30) infinite; }
        .dot-wave__dot:nth-child(3) { animation: dw-jump var(--uib-speed) ease-in-out calc(var(--uib-speed) * -0.15) infinite; }
        .dot-wave__dot:nth-child(4) { animation: dw-jump var(--uib-speed) ease-in-out infinite; }

        @keyframes dw-jump {
          0%, 100% { transform: translateY(0px);    }
          50%       { transform: translateY(-200%);  }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '32px 0' }}>
        <div className="dot-wave">
          <div className="dot-wave__dot" />
          <div className="dot-wave__dot" />
          <div className="dot-wave__dot" />
          <div className="dot-wave__dot" />
        </div>
      </div>
    </>
  );
}
