export default function InlineLoader() {
  return (
    <>
      <style>{`
        .il-wrap {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 32px 0;
        }

        .il-loader {
          display: flex;
          justify-content: center;
          align-items: center;
          --il-color: #3a3a3a;
          --il-anim: 2s ease-in-out infinite;
        }

        .il-circle {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          width: 20px;
          height: 20px;
          border: solid 2px var(--il-color);
          border-radius: 50%;
          margin: 0 10px;
          background-color: transparent;
          animation: il-circle var(--il-anim);
        }

        .il-dot {
          position: absolute;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: var(--il-color);
          animation: il-dot var(--il-anim);
        }

        .il-outline {
          position: absolute;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          animation: il-outline var(--il-anim);
        }

        .il-circle:nth-child(2) { animation-delay: 0.3s; }
        .il-circle:nth-child(3) { animation-delay: 0.6s; }
        .il-circle:nth-child(4) { animation-delay: 0.9s; }

        .il-circle:nth-child(2) .il-dot { animation-delay: 0.3s; }
        .il-circle:nth-child(3) .il-dot { animation-delay: 0.6s; }
        .il-circle:nth-child(4) .il-dot { animation-delay: 0.9s; }

        .il-circle:nth-child(1) .il-outline { animation-delay: 0.9s; }
        .il-circle:nth-child(2) .il-outline { animation-delay: 1.2s; }
        .il-circle:nth-child(3) .il-outline { animation-delay: 1.5s; }
        .il-circle:nth-child(4) .il-outline { animation-delay: 1.8s; }

        @keyframes il-circle {
          0%   { transform: scale(1);   opacity: 1;   }
          50%  { transform: scale(1.5); opacity: 0.5; }
          100% { transform: scale(1);   opacity: 1;   }
        }

        @keyframes il-dot {
          0%   { transform: scale(1); }
          50%  { transform: scale(0); }
          100% { transform: scale(1); }
        }

        @keyframes il-outline {
          0%   { transform: scale(0); outline: solid 20px var(--il-color); outline-offset: 0;   opacity: 1; }
          100% { transform: scale(1); outline: solid 0 transparent;        outline-offset: 20px; opacity: 0; }
        }
      `}</style>

      <div className="il-wrap">
        <div className="il-loader">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="il-circle">
              <div className="il-dot" />
              <div className="il-outline" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
