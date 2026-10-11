import { useEffect, useRef, type RefObject } from "react";
import type { PlaceRegion } from "./graphData";
import { regionInkColor, type InkColors } from "./inkColors";
import type { InkRegion } from "./memberInk";
import { inkBlooms } from "./inkBlooms";

const fragment = `
precision mediump float;
uniform sampler2D pigment;
uniform vec2 resolution;
uniform vec2 pan;
uniform float zoom;
uniform float time;
uniform float dark;
uniform vec3 sea;
varying vec2 uv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(.8,.6,-.6,.8)*p*2.03+4.7;a*=.5;}return n;}
void main(){
  vec2 pixel=vec2(uv.x,1.-uv.y)*resolution;
  vec2 p=(pixel-pan)/zoom/170.;
  vec2 q=vec2(fbm(p+vec2(time*.024,0)),fbm(p+vec2(5.2,1.3-time*.018)));
  vec2 r=vec2(fbm(p+3.6*q+vec2(1.7,9.2)+time*.015),fbm(p+3.4*q+vec2(8.3,2.8)-time*.011));
  float cloud=fbm(p+4.8*r);
  // The blank paper is exactly uniform. Flow only disturbs deposited pigment.
  vec2 warp=(r-.5)*vec2(48.*zoom)/resolution;
  vec4 deposit=texture2D(pigment,clamp(uv+warp,vec2(.001),vec2(.999)));
  vec3 ink=deposit.rgb;
  float spread=.35+.65*(1.-exp(-time*1.4));
  float density=deposit.a*(.74+cloud*.9)*spread;
  float edge=smoothstep(.015,.17,deposit.a);
  float coverage=(1.-exp(-density*3.4))*edge;
  // Broad, soft veils replace metallic contour lines. Layered deposits mix colors.
  vec3 pigmentColor=mix(ink*.65,ink,smoothstep(.2,.75,cloud));
  pigmentColor=mix(pigmentColor,ink*.8+vec3(.2),dark*.22);
  gl_FragColor=vec4(mix(sea,pigmentColor,coverage),1.);
}`;

type Props = { svg: RefObject<SVGSVGElement | null>; regions: PlaceRegion[]; members: InkRegion[]; colors: InkColors; width: number; height: number; view: { x: number; y: number; scale: number } };

/** Location deposits overlap on plain paper; semantic graph positions remain authoritative. */
export function InkOcean(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  const invalidate = useRef(() => {});
  current.current = props;
  useEffect(() => { invalidate.current(); }, [props.regions, props.members, props.colors, props.width, props.height, props.view]);
  useEffect(() => {
    const element = canvas.current, svg = current.current.svg.current;
    if (!element || !svg) return;
    const gl = element.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!; shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Ink shader unavailable");
      return shader;
    };
    const program = gl.createProgram()!;
    try {
      gl.attachShader(program, compile(gl.VERTEX_SHADER, "attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}"));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Ink shader unavailable");
    } catch { shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const uniforms = Object.fromEntries(["pigment","resolution","pan","zoom","time","dark","sea"].map(key => [key, gl.getUniformLocation(program,key)]));
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const mask = document.createElement("canvas"), ctx = mask.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let dirty = true, frame = 0, visible = true, lost = false, last = 0, next = 0, elapsed = 0, quality = 1;
    const drawMask = () => {
      const { width, height, view, colors, regions, members } = current.current;
      const ratio = Math.min(1, 1100 / width) * quality;
      const w = Math.max(1,Math.round(width*ratio)), h = Math.max(1,Math.round(height*ratio));
      if (element.width !== w || element.height !== h) { element.width = mask.width = w; element.height = mask.height = h; }
      ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h);
      ctx.setTransform(ratio*view.scale,0,0,ratio*view.scale,ratio*view.x,ratio*view.y);
      const positions = new Map([...svg.querySelectorAll<SVGGElement>(".graph-node")].map(node=>{
        const matrix=node.transform.baseVal.consolidate()?.matrix;
        return [node.dataset.nodeId!,{x:matrix?.e||0,y:matrix?.f||0}] as const;
      }));
      ctx.globalCompositeOperation="lighter";
      for (const bloom of inkBlooms(members,positions,width)) {
        const region=regions.find(region=>region.id===bloom.id)!;
        const color=regionInkColor(region,regions,colors);
        const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).join(',');
        ctx.save();ctx.translate(bloom.x,bloom.y);ctx.rotate(bloom.angle);ctx.scale(bloom.rx,bloom.ry);
        const gradient=ctx.createRadialGradient(-.12,-.1,0,0,0,1);
        gradient.addColorStop(0,`rgba(${rgb},${bloom.opacity})`);
        gradient.addColorStop(.38,`rgba(${rgb},${bloom.opacity*.85})`);
        gradient.addColorStop(.72,`rgba(${rgb},${bloom.opacity*.3})`);
        gradient.addColorStop(1,`rgba(${rgb},0)`);
        ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      ctx.globalCompositeOperation="source-over";
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);
      gl.viewport(0,0,w,h);
      gl.uniform2f(uniforms.resolution,width,height); gl.uniform2f(uniforms.pan,view.x,view.y); gl.uniform1f(uniforms.zoom,view.scale);
      const paper=getComputedStyle(element.parentElement!).backgroundColor.match(/[\d.]+/g)?.slice(0,3).map(Number)||[248,247,250];
      gl.uniform3f(uniforms.sea,...(paper.map(channel=>channel/255) as [number,number,number]));
      gl.uniform1f(uniforms.dark,document.documentElement.dataset.theme === "dark" ? 1 : 0);
      dirty = false;
    };
    const tick = (now: number) => {
      frame = 0; if (lost || !visible || document.hidden) { last = 0; next = 0; return; }
      const interval = current.current.width < 600 ? 1000/24 : 1000/30;
      if (!dirty && now + 1 < next) { frame=requestAnimationFrame(tick); return; }
      next = next ? Math.max(next + interval, now + 1) : now + interval;
      if (last && now-last > 100 && quality > .65) { quality=.65; dirty=true; }
      elapsed += reduced.matches ? 0 : Math.min(50,last ? now-last : 0)/1000; last=now;
      if (dirty) drawMask();
      gl.uniform1f(uniforms.time,reduced.matches ? 5 : elapsed); gl.drawArrays(gl.TRIANGLES,0,6);
      element.parentElement?.classList.add("ink-ocean-ready");
      if (!reduced.matches) frame=requestAnimationFrame(tick);
    };
    const wake = () => { dirty=true; if (!frame && visible && !document.hidden && !lost) frame=requestAnimationFrame(tick); };
    invalidate.current = wake;
    const mutations = new MutationObserver(wake); mutations.observe(svg,{subtree:true,attributes:true,attributeFilter:["transform"]});
    const theme = new MutationObserver(wake); theme.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    const intersection = new IntersectionObserver(entries => { visible=entries[0].isIntersecting; last=0;next=0; if (!visible) { cancelAnimationFrame(frame);frame=0; } else wake(); }); intersection.observe(element);
    const visibility = () => { last=0;next=0; if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake(); };
    const contextLost = (event: Event) => { event.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;element.parentElement?.classList.remove("ink-ocean-ready"); };
    const contextRestored = () => { /* SVG fallback remains usable until the component remounts. */ };
    element.addEventListener("webglcontextlost",contextLost); element.addEventListener("webglcontextrestored",contextRestored);
    document.addEventListener("visibilitychange",visibility); reduced.addEventListener("change",wake); wake();
    return () => {
      invalidate.current=()=>{}; cancelAnimationFrame(frame); mutations.disconnect();theme.disconnect();intersection.disconnect();
      document.removeEventListener("visibilitychange",visibility);reduced.removeEventListener("change",wake);
      element.removeEventListener("webglcontextlost",contextLost);element.removeEventListener("webglcontextrestored",contextRestored);
      element.parentElement?.classList.remove("ink-ocean-ready");
      gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));
    };
  }, []);
  return <canvas ref={canvas} className="ink-ocean" aria-hidden="true" />;
}
