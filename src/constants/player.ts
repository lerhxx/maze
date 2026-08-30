export const EYE_HEIGHT = 0.3;
export const PLAYER_RADIUS = 0.1;

// ===== Movement =====
export const MOVE_SPEED = 3.2; // units per second
export const TURN_SPEED = 2.2; // radians per second (arrow keys)
export const MOUSE_SENSITIVITY = 0.0022;

// ===== Run (Shift) =====
export const RUN_SPEED_MULTIPLIER = 1.6; // 跑步移动速度倍率

// ===== Animation =====
// 模型只有一个 walking_man clip：
//  - 走路 = 原速播放
//  - 跑步 = 提速播放（模拟跑步步频）
//  - 静止 = timeScale 平滑衰减到 0（自然收步）
export const WALK_ANIM_SPEED = 1.0;
export const RUN_ANIM_SPEED = 1.8;
export const ANIM_BLEND_RATE = 8; // 状态切换的插值速率（越大过渡越快）