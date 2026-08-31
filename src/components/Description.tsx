import { useEffect } from 'react';
import { descriptions } from '../utils/descriptions';

export interface DescriptionProps {
  /** 描述 id，对应 descriptions[id] */
  id: keyof typeof descriptions;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/**
 * 描述气泡（低多边形战斗风 · 珊瑚红战袍 · 左侧内嵌头像版）
 * - fixed 底部居中
 * - 视觉语言参考 lp-bubble-battle：八角切角 / 金色顶线 / 右端折面 / 金色头像框
 * - 内容：title + subTitle + thinks
 * - 按 E 键（忽略大小写）或点击关闭
 */
export function Description({ id, onClose }: DescriptionProps) {
  const data = descriptions[id];

  // E 键关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!data) return null;

  return (
    <>
      <style>{`
        .lpd-overlay {
          position: fixed;
          inset: auto 0 10vh 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: none;
        }
        .lpd-bubble {
          /* 4 阶色阶：浅→深 */
          --lp-c1: #FDEBE6;
          --lp-c2: #F0A08C;
          --lp-c3: #E4694E;
          --lp-c4: #C24329;
          --lp-ink: #5F1F12;
          --lp-ink2: #8A3320;
          --lp-gold: #E8B44C;

          position: relative;
          width: min(560px, 86vw);
          padding: 18px 56px 18px 16px;
          background: var(--lp-c2);
          clip-path: polygon(
            16px 0, calc(100% - 16px) 0, 100% 16px,
            100% calc(100% - 16px), calc(100% - 16px) 100%,
            16px 100%, 0 calc(100% - 16px), 0 16px
          );
          isolation: isolate;
          display: flex;
          align-items: center;
          gap: 14px;
          pointer-events: auto;
          cursor: pointer;
          animation: lpd-pop .22s ease-out;
        }
        @keyframes lpd-pop {
          from { transform: translateY(12px) scale(.96); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        /* 顶部金线 + 右端一道折面暗部（左侧内嵌头像版简化折痕） */
        .lpd-bubble::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, var(--lp-gold) 0, var(--lp-gold) 5px, transparent 5.5%),
            linear-gradient(245deg, transparent 84%, var(--lp-c3) 84.5%, var(--lp-c3) 94%, transparent 94.5%);
          pointer-events: none;
        }
        .lpd-avatar-wrap {
          width: 56px;
          height: 56px;
          flex: 0 0 56px;
          padding: 3px;
          background: var(--lp-gold);
          clip-path: polygon(
            50% 0, 88% 14%, 100% 42%, 100% 70%,
            88% 100%, 12% 100%, 0 70%, 0 42%, 12% 14%
          );
        }
        .lpd-avatar {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          clip-path: inherit;
        }
        .lpd-body {
          flex: 1;
          min-width: 0;
          position: relative;
        }
        .lpd-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--lp-ink);
          letter-spacing: .5px;
          margin-bottom: 2px;
        }
        .lpd-sub {
          font-size: 12px;
          color: var(--lp-ink2);
          letter-spacing: .3px;
          margin-bottom: 8px;
        }
        .lpd-thinks {
          background: rgba(253, 235, 230, .78);
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lpd-thinks p {
          margin: 0;
          font-size: 13px;
          line-height: 1.7;
          color: #7A4030;
        }
      `}</style>

      <div className="lpd-overlay">
        <div className="lpd-bubble" onClick={onClose} title="按 E 键或点击关闭">
          <div className="lpd-avatar-wrap">
            <img
              className="lpd-avatar"
              src={`${import.meta.env.BASE_URL}/avatar.webp`}
              alt="Q版头像"
              draggable={false}
            />
          </div>
          <div className="lpd-body">
            <div className="lpd-title">{data.title} · <span className="lpd-sub">{data.subTitle}</span></div>
            <div className="lpd-thinks">
              {data.thinks?.map((item, i) => (
                <p key={i}>{item}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Description;
