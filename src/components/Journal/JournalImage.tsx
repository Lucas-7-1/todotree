import React, { useEffect, useRef, useState } from "react";
import { ImageOff, X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { journal } from "../../services/journal/store";
export function JournalImage({
  id,
  large = false,
  alt = "手帐照片",
}: {
  id: string;
  large?: boolean;
  alt?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let alive = true,
      started = false;
    setUrl("");
    setError(false);
    const load = () => {
      if (started) return;
      started = true;
      journal
        .media(id)
        .then((m) => {
          if (alive) setUrl(large ? m.preview : m.thumbnail);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    };
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (es) => {
              if (es.some((e) => e.isIntersecting)) load();
            },
            { rootMargin: "250px" },
          )
        : null;
    if (observer && ref.current) observer.observe(ref.current);
    else load();
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [id, large]);
  return (
    <div ref={ref} className={`j-image ${error ? "is-missing" : ""}`}>
      {error ? (
        <span>
          <ImageOff size={24} />
          照片暂不可读
          <br />
          可从备份恢复
        </span>
      ) : url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setError(true)}
        />
      ) : (
        <span className="j-image-placeholder" />
      )}
    </div>
  );
}
export function JournalViewer({
  images,
  index,
  onClose,
  coverId,
  onSetCover,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  coverId?: string | null;
  onSetCover?: (id:string)=>Promise<void>;
}) {
  const [at, setAt] = useState(index),
    [zoom, setZoom] = useState(false),
    [error, setError] = useState("");
  const touch = useRef({x:0,y:0});
  const [setting,setSetting]=useState(false);
  useEffect(() => {
    const back = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("todotree:back", back, true);
    return () => window.removeEventListener("todotree:back", back, true);
  }, [onClose]);
  const change = (n: number) => {
    setAt(Math.max(0, Math.min(images.length - 1, n)));
    setZoom(false);
  };
  return (
    <div className="j-viewer" role="dialog" aria-label="查看照片">
      <header>
        <button onClick={onClose} aria-label="关闭照片">
          <X />
        </button>
        <span>
          {at + 1} / {images.length}
        </span>
        <button
          onClick={() =>
            void journal.original(images[at]).catch((e) => setError(e.message))
          }
        >
          原图
        </button>
      </header>
      {error && <p>{error}</p>}
      <div
        className={`j-viewer-image ${zoom ? "is-zoomed" : ""}`}
        onDoubleClick={() => setZoom((v) => !v)}
        onTouchStart={(e) => {
          touch.current = {x:e.touches[0].clientX,y:e.touches[0].clientY};
        }}
        onTouchEnd={(e) => {
          if (zoom) return;
          const delta = e.changedTouches[0].clientX - touch.current.x;
          const dy=e.changedTouches[0].clientY-touch.current.y;
          if (Math.abs(delta) > 50 && Math.abs(delta)>Math.abs(dy)*1.4) change(at + (delta < 0 ? 1 : -1));
        }}
      >
        <JournalImage id={images[at]} large />
      </div>
      {images.length>1 && <div className="j-viewer-thumbs">{images.map((id,i)=><button key={id} aria-label={`跳到第 ${i+1} 张`} aria-pressed={i===at} onClick={()=>change(i)}>{Math.abs(i-at)<=1?<JournalImage id={id}/>:<span>{i+1}</span>}{id===coverId&&<small>封面</small>}</button>)}</div>}
      {onSetCover && <div className="j-viewer-cover"><button disabled={setting||images[at]===coverId} onClick={async()=>{setSetting(true);setError('');try{await onSetCover(images[at]);}catch(e){setError((e as Error).message);}finally{setSetting(false);}}}>{setting?'正在设置…':images[at]===coverId?'当前封面':'设为封面'}</button><small>滑动只翻图，不自动更换封面</small></div>}
      <footer>
        <button
          disabled={!at}
          onClick={() => change(at - 1)}
          aria-label="上一张"
        >
          <ChevronLeft />
        </button>
        <button onClick={() => setZoom((v) => !v)}>
          <ZoomIn size={18} />
          {zoom ? "适应屏幕" : "放大"}
        </button>
        <button
          disabled={at === images.length - 1}
          onClick={() => change(at + 1)}
          aria-label="下一张"
        >
          <ChevronRight />
        </button>
      </footer>
    </div>
  );
}
