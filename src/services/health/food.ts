import { apiFetch } from "../native/platform";
import { FoodSnapshot } from "./model";

const aliases: Record<string, string> = {
  鸡蛋: "egg",
  米饭: "rice cooked",
  鸡胸肉: "chicken breast",
  牛奶: "milk",
  苹果: "apple",
  香蕉: "banana",
  燕麦: "oats",
  土豆: "potato",
  西兰花: "broccoli",
  豆腐: "tofu",
  牛肉: "beef",
  猪肉: "pork",
  三文鱼: "salmon",
  酸奶: "yogurt",
  面包: "bread",
};
export const commonFoods = Object.keys(aliases);
export function foodIcon(name: string) {
  return /鸡|牛|猪|肉|beef|pork|chicken/i.test(name)
    ? "🍗"
    : /奶|酸奶|milk|yogurt/i.test(name)
      ? "🥛"
      : /蛋|egg/i.test(name)
        ? "🥚"
        : /饭|燕麦|米|rice|oat|bread/i.test(name)
          ? "🍚"
          : /苹果|香蕉|apple|banana/i.test(name)
            ? "🍎"
            : "🥗";
}
export function parseFoodSearch(data: any): FoodSnapshot[] {
  return (data.foods || [])
    .filter((f: any) => f.fdcId && typeof f.description === "string")
    .slice(0, 12)
    .map((f: any) => {
      const energy = (f.foodNutrients || []).find(
        (n: any) =>
          (n.nutrientId === 1008 || n.nutrientNumber === "208") &&
          String(n.unitName).toUpperCase() === "KCAL",
      );
      const kcal =
        typeof energy?.value === "number" &&
        Number.isFinite(energy.value) &&
        energy.value >= 0
          ? energy.value
          : null;
      return {
        id: "fdc-" + f.fdcId,
        name: f.description,
        state: f.description,
        source: "USDA FoodData Central",
        source_id: String(f.fdcId),
        source_url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
        kcal_per_100g: kcal,
        captured_at: new Date().toISOString(),
        data_type: f.dataType,
      };
    });
}
const recentSearches = new Map<
  string,
  { until: number; foods: FoodSnapshot[] }
>();
/** Explicit searches only: no request for every keystroke and no automatic retry loop. */
export async function searchFoods(query: string, signal: AbortSignal) {
  const text = query.trim();
  if (!text) throw Error("输入食物名称");
  const cached = recentSearches.get(text);
  if (cached && cached.until > Date.now()) return structuredClone(cached.foods);
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", "DEMO_KEY");
  url.searchParams.set("query", aliases[text] || text);
  url.searchParams.set("pageSize", "12");
  url.searchParams.set("dataType", "Foundation,SR Legacy");
  const response = await apiFetch(url.toString(), { signal });
  if (!response.ok)
    throw Error(
      response.status === 429
        ? "公共食品查询额度暂时用完，可以手动记录或稍后再查"
        : "食品来源暂不可用，可以直接保存名称与克重",
    );
  const foods = parseFoodSearch(await response.json());
  recentSearches.set(text, { until: Date.now() + 15 * 60000, foods });
  if (recentSearches.size > 60)
    recentSearches.delete(recentSearches.keys().next().value!);
  return structuredClone(foods);
}
