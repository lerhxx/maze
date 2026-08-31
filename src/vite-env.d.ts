/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 是否通过 jsDelivr CDN 加载大模型 glb（开发环境可切换） */
  readonly VITE_CDN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vert?raw' {
  const value: string;
  export default value;
}

declare module '*.frag?raw' {
  const value: string;
  export default value;
}

declare module '*.glsl?raw' {
  const value: string;
  export default value;
}
