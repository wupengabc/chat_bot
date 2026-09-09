import type { Component } from "vue";
import OpenPetsPluginDoc from "./OpenPetsPluginDoc.vue";
import PublicInfoDoc from "./PublicInfoDoc.vue";

export interface WebDocument {
  id: string;
  group: string;
  title: string;
  summary: string;
  method?: string;
  path?: string;
  component: Component;
}

export const webDocuments: WebDocument[] = [
  {
    id: "openpets-plugin",
    group: "OpenPets",
    title: "宠物插件配置",
    summary: "连接服务器动态插件",
    component: OpenPetsPluginDoc,
  },
  {
    id: "public-info",
    group: "公共 API",
    title: "游戏公开信息",
    summary: "轮询公开聊天与在线玩家",
    method: "GET",
    path: "/api/public/info",
    component: PublicInfoDoc,
  },
];
