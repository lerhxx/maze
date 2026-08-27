import { useEffect } from 'react';
import { descriptions } from '../utils/descriptions';

export interface DescriptionProps {
  /** 描述 id，对应 descriptions[id] */
  id: keyof typeof descriptions;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/**
 * 描述弹窗：
 * - fixed 全局居中
 * - 背景是 /desc.png
 * - 内容来自 descriptions[id]
 * - 按 E 键（忽略大小写）关闭
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(600px, 90vw)',
          height: '80vh',
          backgroundImage: `url(${import.meta.env.BASE_URL}/desc.png)`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          overflowY: 'auto',
          color: '#3a2a18',
          fontFamily:
            '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          lineHeight: 1.65,
        }}
      >
        {/* 内容区 */}
        <div style={{ padding: '0 125px',  }}>
          {/* 标题 */}
          <h1
            style={{
              margin: 0,
              marginTop: 50,
              fontSize: 35,
              fontWeight: 700,
              textAlign: 'center',
              color: '#5a3a1a',
              letterSpacing: 2,
            }}
          >
            {data.title}
          </h1>
          <p style={{ margin: 0, textAlign: 'center', color: '#5d4526', fontSize: 20, }}>{ data.subTitle }</p>

          {/* 日期 */}
          <div
            style={{
              margin: '8px 0',
              fontSize: 14,
              textAlign: 'center',
              color: '#8a6a3f',
              fontStyle: 'italic',
            }}
          >
            {data.date}
          </div>

          {/* 关闭提示 */}
          {/* <div
            style={{
              marginTop: 20,
              fontSize: 12,
              textAlign: 'center',
              color: '#a08060',
            }}
          >
            按 <kbd style={kbdStyle}>E</kbd> 关闭
          </div> */}

          {/* 分段描述 */}
          {/* <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.desc?.map((item, i) => (
              <section
                key={i}
              >
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: '#5a3a1a',
                    marginBottom: 6,
                  }}
                >
                  {item.title}
                </div>
                <div style={{ fontSize: 14, color: '#5a4a3a' }}>{item.desc}</div>
              </section>
            ))}
          </div> */}

          {/* 感想 */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.thinks?.map((item, i) => (
              <section key={i}>
                <div style={{ fontSize: 14, color: '#5a4a3a' }}>{item}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Description;
