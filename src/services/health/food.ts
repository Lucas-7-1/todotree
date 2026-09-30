import legacyFoods from '../../data/usda-sr-legacy.json';
import { isAndroid } from "../native/platform";
import { loadConnections } from "../connections/store";
import { providerRequest } from "../connections/request";
import { FoodSnapshot } from "./model";

const aliases: Record<string, string> = {
  鸡蛋: "egg whole",
  米饭: "rice cooked",
  鸡胸肉: "Chicken, broilers or fryers, breast, meat only",
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
  面包: "bread", 花生: "peanuts", 核桃: "walnuts", 杏仁: "almonds", 橄榄油: "oil olive", 食用油: "oil", 黄油: "butter", 生菜: "lettuce", 菠菜: "spinach", 黄瓜: "cucumber", 番茄: "tomatoes", 西红柿: "tomatoes", 胡萝卜: "carrots", 卷心菜: "cabbage", 白菜: "cabbage chinese", 蘑菇: "mushrooms", 玉米: "corn", 红薯: "sweet potato", 糙米: "rice brown", 面条: "noodles", 面粉: "flour", 虾: "shrimp", 金枪鱼: "tuna", 鸡腿: "chicken thigh", 鸡翅: "chicken wing", 猪里脊: "pork loin", 牛排: "beef steak", 羊肉: "lamb", 葡萄: "grapes", 橙子: "oranges", 草莓: "strawberries", 蓝莓: "blueberries", 西瓜: "watermelon", 梨: "pears", 桃: "peaches", 芒果: "mangos", 菠萝: "pineapple", 豆浆: "soymilk", 奶酪: "cheese", 咖啡: "coffee", 茶: "tea", 蜂蜜: "honey", 白糖: "sugars", 盐: "salt", 酱油: "soy sauce", 南瓜: "pumpkin", 茄子: "eggplant", 青椒: "peppers", 洋葱: "onions", 芹菜: "celery", 豌豆: "peas", 红豆: "beans adzuki", 绿豆: "beans mung", 扁豆: "lentils", 鹰嘴豆: "chickpeas", 芝麻: "sesame", 花生酱: "peanut butter",
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
        provider: "usda",
        license_url: "https://fdc.nal.usda.gov/data-documentation.html",
        source: "USDA FoodData Central",
        source_id: String(f.fdcId),
        source_url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
        kcal_per_100g: kcal,
        captured_at: new Date().toISOString(),
        data_type: f.dataType,
      };
    });
}
export type FoodProvider = 'local' | 'usda' | 'off' | 'personal';
export function searchLocalFoods(query:string):FoodSnapshot[] {
  let text=query.trim().toLowerCase();
  const states:{[key:string]:string}={水煮:'cooked',煮熟:'cooked',熟:'cooked',生:'raw',烤:'roasted',炸:'fried',蒸:'cooked'};
  let preparation='';
  for(const [word,term] of Object.entries(states))if(!aliases[text]&&text.includes(word)&&text!==word){preparation=term;text=text.replace(word,'').replace(/[（）()]/g,'').trim();break;}
  const hint=aliases[text]||text;
  const tokens=(hint+' '+preparation).toLowerCase().match(/[a-z0-9]+/g)||[];
  if(!tokens.length)return [];
  const first=tokens[0]||'';
  return (legacyFoods as [number,string,number|null][]).filter(row=>{const words=new Set(row[1].toLowerCase().match(/[a-z0-9]+/g)||[]);return tokens.every(t=>words.has(t)||words.has(t+'s'));}).sort((a,b)=>((a[1].toLowerCase().startsWith(first)?0:1000)+a[1].length)-((b[1].toLowerCase().startsWith(first)?0:1000)+b[1].length)).slice(0,30).map(row=>({id:'fdc-'+row[0],name:row[1],state:row[1],provider:'usda',source:'USDA SR Legacy（离线）',source_id:String(row[0]),source_url:'https://fdc.nal.usda.gov/food-details/'+row[0]+'/nutrients',kcal_per_100g:row[2],captured_at:new Date().toISOString(),data_type:'SR Legacy · 核对生熟/做法',source_version:'2018-04',license_url:'https://fdc.nal.usda.gov/data-documentation.html'}));
}

const recentSearches = new Map<string,{until:number;foods:FoodSnapshot[]}>();
const calls: Record<string,number[]> = {};
const cooldown = new Map<string,number>();
function rateLimit(source:string, maximum:number) {
  const now=Date.now();
  if((cooldown.get(source)||0)>now) throw Error('来源正在冷却，请稍后再查；可继续手动记录');
  calls[source]=(calls[source]||[]).filter(t=>now-t<60_000);
  if(calls[source].length>=maximum)throw Error('查询过于频繁，请一分钟后再试；记录仍可保存');
  calls[source].push(now);
}
/** OFF energy values use a common _100g field for both g and ml. Never infer density. */
export function parsePackagedFood(data:any): FoodSnapshot[] {
  const p=data?.product;
  if(!p || !String(p.product_name_zh||p.product_name||'').trim())return [];
  const n=p.nutriments||{};
  const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  let kcal=finite(n['energy-kcal_100g']);
  if(kcal===null) {const kj=finite(n['energy-kj_100g']);if(kj!==null)kcal=Math.round(kj/4.184*100)/100;}
  // Package volume/weight does not establish the nutrition table's basis.
  // Legacy OFF _100g covers both g and ml: keep it unconfirmed until the user checks packaging.
  const servingKcal=finite(n['energy-kcal_serving']);
  const basis=p.nutrition_data_per==='serving' && servingKcal!==null ? 'serving' : p.nutrition_data_per==='100ml' ? '100ml' : 'unknown';
  if(basis==='serving')kcal=servingKcal;
  const code=String(p.code||data.code||'');
  if(!/^\d{8,14}$/.test(code)) return [];
  return [{id:'off-'+code,name:String(p.product_name_zh||p.product_name).slice(0,300),state:'包装食品，请核对品牌与包装',provider:'off',brand:String(p.brands||'').slice(0,200),barcode:code,source:'Open Food Facts（众包）',source_id:code,source_url:'https://world.openfoodfacts.org/product/'+code,kcal_per_100g:null,label_energy:{kcal,basis},captured_at:new Date().toISOString(),data_type:'包装营养标签',license_url:'https://world.openfoodfacts.org/terms-of-use'}];
}
export function nutritionLabel(food:FoodSnapshot) {
  if(food.kcal_per_100g!==null)return food.kcal_per_100g+' kcal / 100g';
  const label=food.label_energy;
  if(label?.kcal!==null&&label?.kcal!==undefined)return label.kcal+(label.basis==='100ml'?' kcal / 100ml；不可直接换算克重':label.basis==='serving'?' kcal / 份':' kcal / 100单位；请核对单位');
  return '能量未知';
}
export async function searchFoods(query:string, signal:AbortSignal, source:FoodProvider='usda'):Promise<FoodSnapshot[]> {
  const text=query.trim();if(!text||text.length>200)throw Error('输入有效的食物名称或条码');
  if(source==='local')return searchLocalFoods(text);
  const config=await loadConnections();if(signal.aborted)throw new DOMException('查询已取消','AbortError');
  if(source==='personal')return structuredClone(config.settings.foods.filter(f=>[f.name,f.state,f.brand||'',f.barcode||''].some(v=>v.toLowerCase().includes(text.toLowerCase()))).slice(0,30));
  const key=source+':'+(source==='usda'?config.secrets.usda_key||'demo':'public')+':'+text;
  const cache=recentSearches.get(key);if(cache&&cache.until>Date.now())return structuredClone(cache.foods);
  let url:URL;let headers:Record<string,string>={};
  if(source==='off') {
    if(!config.settings.off_enabled)throw Error('包装食品查询未开启，可在连接设置中开启');
    if(!/^\d{8,14}$/.test(text))throw Error('输入包装上的 8–14 位条码；普通食材请切换 USDA 或个人标签');
    url=new URL('https://world.openfoodfacts.org/api/v3.6/product/'+text+'.json');
    url.searchParams.set('fields','code,product_name,product_name_zh,brands,quantity,product_quantity_unit,nutriments,nutrition_data_per,serving_size,serving_quantity');
    // Web browsers control User-Agent; Android supplies the documented app/contact identifier.
    if(isAndroid())headers['User-Agent']='TodoTree/1.0 (https://github.com/Lucas-7-1/todotree)';
    rateLimit(source,15);
  } else {
    url=new URL('https://api.nal.usda.gov/fdc/v1/foods/search');url.searchParams.set('api_key',config.secrets.usda_key||'DEMO_KEY');url.searchParams.set('query',aliases[text]||text);url.searchParams.set('pageSize','12');url.searchParams.set('dataType','Foundation,SR Legacy');rateLimit(source,config.secrets.usda_key?10:5);
  }
  let result:any;
  try { result=await providerRequest(url.toString(),signal,{headers}); } catch(e:any) {if(e.retry_after)cooldown.set(source,Date.now()+e.retry_after*1000);throw e;}
  if(signal.aborted)throw new DOMException('查询已取消','AbortError');
  const foods=source==='off'?parsePackagedFood(result):parseFoodSearch(result);
  recentSearches.set(key,{until:Date.now()+15*60_000,foods});if(recentSearches.size>60)recentSearches.delete(recentSearches.keys().next().value!);
  return structuredClone(foods);
}
