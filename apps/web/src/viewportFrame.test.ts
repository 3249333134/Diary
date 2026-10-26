import {expect,it} from 'vitest';
import {viewportFrame} from './viewportFrame';

it('fills a resized desktop even if visualViewport still reports the previous size',()=>{
 expect(viewportFrame({width:624,height:1100},{width:624,height:800,scale:1},false)).toEqual({width:624,height:1100,left:0,top:0});
 expect(viewportFrame({width:624,height:650},{width:624,height:1100,scale:1},false).height).toBe(650);
});
it('keeps touch keyboard controls inside the visible frame and bounds keyboard pan',()=>{
 expect(viewportFrame({width:375,height:900},{width:375,height:540,offsetTop:40,scale:1},true)).toEqual({width:375,height:540,left:0,top:40});
 expect(viewportFrame({width:375,height:900},{width:375,height:540,offsetTop:500,scale:1},true).top).toBe(360);
});
it('uses both dimensions during pinch zoom and recovers from missing viewport readings',()=>{
 expect(viewportFrame({width:624,height:1100},{width:499.2,height:880,offsetLeft:50,offsetTop:120,scale:1.25},false)).toEqual({width:499.2,height:880,left:50,top:120});
 expect(viewportFrame({width:624,height:1100},undefined,true)).toEqual({width:624,height:1100,left:0,top:0});
 expect(viewportFrame({width:624,height:1100},{width:0,height:0},true).height).toBe(1100);
});
