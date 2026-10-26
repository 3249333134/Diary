export type ViewportReading={width:number;height:number;offsetLeft?:number;offsetTop?:number;scale?:number};
/** Desktop resize uses layout dimensions; touch keyboards and pinch zoom use the visible frame. */
export function viewportFrame(layout:ViewportReading,visual:ViewportReading|undefined,touch:boolean){
 const useVisual=!!visual&&(touch||Math.abs((visual.scale||1)-1)>.01);
 const width=useVisual&&visual!.width>0?Math.min(layout.width,visual!.width):layout.width;
 const height=useVisual&&visual!.height>0?Math.min(layout.height,visual!.height):layout.height;
 return {width,height,left:useVisual?Math.max(0,Math.min(visual!.offsetLeft||0,layout.width-width)):0,top:useVisual?Math.max(0,Math.min(visual!.offsetTop||0,layout.height-height)):0};
}
