/** 用法：pnpm search:verify <web_id> <纬度> <经度> <区域> <核实来源> */
import { loadEnv } from "../src/lib/env";
import { verifyWebCard } from "../src/lib/search/store";
loadEnv();
const [poiId, latRaw, lngRaw, area, provider] = process.argv.slice(2);
if (!poiId || !latRaw || !lngRaw || !area || !provider) {
  console.error("用法：pnpm search:verify <web_id> <纬度> <经度> <区域> <核实来源>");
  process.exitCode = 1;
} else {
  try {
    const card = verifyWebCard(poiId, Number(latRaw), Number(lngRaw), area, provider);
    console.log(`已核实 ${card.name} (${card.id})：${card.lat}, ${card.lng}；来源：${card.geoProvider}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
