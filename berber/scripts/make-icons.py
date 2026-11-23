# Berberim ana ekran simgeleri: lacivert zemin, çapraz beyaz ustura ve tarak.
#   python3 scripts/make-icons.py icons && bun scripts/icons-to-js.mjs
# icon-*.png: yuvarlak köşeli (any), icon-*-maskable.png: köşesiz tam kare (maskable).
from PIL import Image, ImageDraw, ImageFilter
import math, sys
NAVY=(20,33,74,255); WHITE=(255,255,255,255)
def rot(pts, ang, c):
    a=math.radians(ang); cx,cy=c
    return [(cx+(x-cx)*math.cos(a)-(y-cy)*math.sin(a), cy+(x-cx)*math.sin(a)+(y-cy)*math.cos(a)) for x,y in pts]
def layer(S, ang, draw_fn):
    L=Image.new("RGBA",(S,S),(0,0,0,0)); draw_fn(ImageDraw.Draw(L),S)
    return L.rotate(-ang, resample=Image.BICUBIC, center=(S/2,S/2))
def razor(d,S):
    # vertical straight razor centered; safe zone ~ 62% of canvas tall
    cx=S/2; top=S*0.19; bot=S*0.81; u=S/100
    # blade (upper part): thick rounded rect with slanted tip
    bw=11*u
    d.polygon([(cx-bw/2,top+5*u),(cx+bw/2,top),(cx+bw/2,S*0.52),(cx-bw/2,S*0.52)],fill=WHITE)
    # pivot
    d.ellipse([cx-4.5*u,S*0.52-4.5*u,cx+4.5*u,S*0.52+4.5*u],fill=WHITE)
    # handle (lower): slightly narrower, rounded, with gap
    hw=7*u
    d.rounded_rectangle([cx-hw/2,S*0.555,cx+hw/2,bot],radius=hw/2,fill=WHITE)
def comb(d,S):
    cx=S/2; top=S*0.19; bot=S*0.81; u=S/100
    spine=8*u; teeth_len=10*u; tw=4.2*u; gap=3.0*u
    x0=cx-(spine+teeth_len)/2
    d.rounded_rectangle([x0,top,x0+spine,bot],radius=2*u,fill=WHITE)
    y=top+2*u
    while y+tw<=bot-2*u:
        d.rounded_rectangle([x0+spine-1,y,x0+spine+teeth_len,y+tw],radius=tw/2,fill=WHITE); y+=tw+gap
def make(S, rounded):
    base=Image.new("RGBA",(S,S),(0,0,0,0))
    bg=Image.new("RGBA",(S,S),NAVY)
    if rounded:
        m=Image.new("L",(S,S),0); ImageDraw.Draw(m).rounded_rectangle([0,0,S-1,S-1],radius=round(S*14/64),fill=255)
        base.paste(bg,(0,0),m)
    else: base=bg
    hi=S*4
    art=Image.new("RGBA",(hi,hi),(0,0,0,0))
    art.alpha_composite(layer(hi,45,comb))
    r=layer(hi,-45,razor); a=r.split()[3].filter(ImageFilter.MaxFilter(int(hi*0.022)|1))
    halo=Image.new("RGBA",(hi,hi),NAVY); halo.putalpha(a); art.alpha_composite(halo); art.alpha_composite(r)
    # outline razor over comb for separation
    art=art.resize((S,S),Image.LANCZOS)
    base.alpha_composite(art); return base
out=sys.argv[1]
for S in (192,512):
    make(S,False).save(f"{out}/icon-{S}-maskable.png")
    make(S,True).save(f"{out}/icon-{S}.png")
