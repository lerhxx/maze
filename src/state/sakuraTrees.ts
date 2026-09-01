/**
 * 樱花树注册表。
 *
 * Wall.tsx（PerimeterSakuraCells）在挂载时把每棵树的树冠世界坐标登记进来，
 * SakuraPetals 读取它，只在「玩家视线内」的树上生成花瓣 —— 这样花瓣看起来是
 * 从玩家看到的那些樱花树上飘下来的，而不是凭空出现在空中。
 *
 * 与 sceneStore 一样用单例模拟，不引入额外状态库。
 */

export interface SakuraTree {
  /** 树根世界坐标（贴地，y = 0） */
  x: number;
  z: number;
  /** 树冠中心高度（世界单位） */
  crownY: number;
  /** 树冠半径（世界单位） */
  crownRadius: number;
}

class SakuraTreeRegistry {
  /** 按批次存放，便于整批注销（外围树 / 内部树是两个组件、两批） */
  private batches = new Map<number, readonly SakuraTree[]>();
  private nextId = 1;
  /** 扁平化缓存：树只在注册/注销时变化，避免每帧重新拼接 */
  private flat: SakuraTree[] = [];
  private dirty = true;

  /** 注册一批树，返回注销函数 */
  register(trees: readonly SakuraTree[]): () => void {
    const id = this.nextId++;
    this.batches.set(id, trees);
    this.dirty = true;
    return () => {
      this.batches.delete(id);
      this.dirty = true;
    };
  }

  /** 全部已注册的树 */
  getAll(): readonly SakuraTree[] {
    if (this.dirty) {
      this.flat = [];
      this.batches.forEach((batch) => {
        for (let i = 0; i < batch.length; i++) this.flat.push(batch[i]);
      });
      this.dirty = false;
    }
    return this.flat;
  }
}

export const sakuraTrees = new SakuraTreeRegistry();
