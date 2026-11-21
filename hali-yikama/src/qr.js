// Küçük QR kodu üreticisi (bayt kipi, hata düzeltme M, sürüm 1-10, ~210 karaktere kadar).
// Dış kütüphane yok; SVG olarak çizer.
var QR = (function () {
  // [toplam kod sözcüğü, blok başına hata düzeltme, [[blok sayısı, veri sözcüğü], ...]]
  var T = [null, [26, 10, [[1, 16]]], [44, 16, [[1, 28]]], [70, 26, [[1, 44]]], [100, 18, [[2, 32]]], [134, 24, [[2, 43]]], [172, 16, [[4, 27]]], [196, 18, [[4, 31]]], [242, 22, [[2, 38], [2, 39]]], [292, 22, [[3, 36], [2, 37]]], [346, 26, [[4, 43], [1, 44]]]]
  var AL = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
  function mul(x, y) {
    var z = 0
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d)
      z ^= ((y >>> i) & 1) * x
    }
    return z & 255
  }
  function rsDivisor(deg) {
    var r = []
    for (var i = 0; i < deg - 1; i++) r.push(0)
    r.push(1)
    var root = 1
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = mul(r[j], root)
        if (j + 1 < r.length) r[j] ^= r[j + 1]
      }
      root = mul(root, 2)
    }
    return r
  }
  function rsRem(data, div) {
    var r = div.map(function () { return 0 })
    data.forEach(function (b) {
      var f = b ^ r.shift()
      r.push(0)
      div.forEach(function (c, i) { r[i] ^= mul(c, f) })
    })
    return r
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s))
    return unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0) })
  }
  function dataCap(v) { return T[v][2].reduce(function (t, g) { return t + g[0] * g[1] }, 0) }

  function encode(text) {
    var data = utf8(text), ver
    for (ver = 1; ver <= 10; ver++) if (4 + (ver < 10 ? 8 : 16) + data.length * 8 <= dataCap(ver) * 8) break
    if (ver > 10) throw new Error('QR için metin çok uzun')
    var bits = []
    var push = function (v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1) }
    push(4, 4)
    push(data.length, ver < 10 ? 8 : 16)
    data.forEach(function (b) { push(b, 8) })
    var capBits = dataCap(ver) * 8
    push(0, Math.min(4, capBits - bits.length))
    while (bits.length % 8) bits.push(0)
    for (var pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8)
    var bytes = []
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
      bytes.push(b)
    }
    // Bloklara böl, hata düzeltme ekle, iç içe geçir
    var ecLen = T[ver][1], div = rsDivisor(ecLen), blocks = [], k = 0
    T[ver][2].forEach(function (g) {
      for (var n = 0; n < g[0]; n++) {
        var d = bytes.slice(k, k + g[1])
        k += g[1]
        blocks.push({ d: d, e: rsRem(d, div) })
      }
    })
    var out = [], maxD = Math.max.apply(null, blocks.map(function (x) { return x.d.length }))
    for (i = 0; i < maxD; i++) blocks.forEach(function (x) { if (i < x.d.length) out.push(x.d[i]) })
    for (i = 0; i < ecLen; i++) blocks.forEach(function (x) { out.push(x.e[i]) })

    var size = ver * 4 + 17, M = [], F = []
    for (i = 0; i < size; i++) {
      M.push(new Array(size).fill(false))
      F.push(new Array(size).fill(false))
    }
    var set = function (x, y, dark) { M[y][x] = !!dark; F[y][x] = true }
    for (i = 0; i < size; i++) {
      set(6, i, i % 2 === 0)
      set(i, 6, i % 2 === 0)
    }
    ;[[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++)
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, dist !== 2 && dist !== 4)
        }
    })
    var al = AL[ver], na = al.length
    for (i = 0; i < na; i++)
      for (j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    var drawFormat = function (mask) {
      var d = (0 << 3) | mask, rem = d // M seviyesi: 00
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
      var f = ((d << 10) | rem) ^ 0x5412
      var g = function (i) { return (f >>> i) & 1 }
      for (i = 0; i <= 5; i++) set(8, i, g(i))
      set(8, 7, g(6))
      set(8, 8, g(7))
      set(7, 8, g(8))
      for (i = 9; i < 15; i++) set(14 - i, 8, g(i))
      for (i = 0; i < 8; i++) set(size - 1 - i, 8, g(i))
      for (i = 8; i < 15; i++) set(8, size - 15 + i, g(i))
      set(8, size - 8, 1)
    }
    drawFormat(0)
    if (ver >= 7) {
      var rem = ver
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
      var vb = (ver << 12) | rem
      for (i = 0; i < 18; i++) {
        var bit = (vb >>> i) & 1, a = size - 11 + (i % 3), c = Math.floor(i / 3)
        set(a, c, bit)
        set(c, a, bit)
      }
    }
    // Veri yerleşimi (zikzak)
    var bi = 0
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (var vert = 0; vert < size; vert++)
        for (j = 0; j < 2; j++) {
          var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert
          if (!F[y][x] && bi < out.length * 8) {
            M[y][x] = ((out[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1
            bi++
          }
        }
    }
    var maskFn = [
      function (x, y) { return (x + y) % 2 === 0 },
      function (x, y) { return y % 2 === 0 },
      function (x) { return x % 3 === 0 },
      function (x, y) { return (x + y) % 3 === 0 },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0 },
      function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0 },
      function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0 },
      function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0 },
    ]
    var applyMask = function (m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!F[y][x] && maskFn[m](x, y)) M[y][x] = !M[y][x]
    }
    var penalty = function () {
      var p = 0, dark = 0, x, y
      for (y = 0; y < size; y++) {
        var run = 1, runX = 1
        for (x = 0; x < size; x++) {
          if (M[y][x]) dark++
          if (x > 0) {
            if (M[y][x] === M[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1
            if (M[x][y] === M[x - 1][y]) { runX++; if (runX === 5) p += 3; else if (runX > 5) p++ } else runX = 1
          }
          if (x < size - 1 && y < size - 1 && M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3
        }
      }
      return p + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10
    }
    var best = 0, bestP = Infinity
    for (var m = 0; m < 8; m++) {
      applyMask(m)
      drawFormat(m)
      var pp = penalty()
      if (pp < bestP) { bestP = pp; best = m }
      applyMask(m)
    }
    applyMask(best)
    drawFormat(best)
    return { size: size, mod: M, ver: ver, mask: best }
  }

  function svg(text, px) {
    var q = encode(text), n = q.size + 8, d = ''
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.mod[y][x]) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z'
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '"' + (px ? ' width="' + px + '" height="' + px + '"' : '') + ' shape-rendering="crispEdges" role="img" aria-label="QR kodu"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>'
  }
  return { encode: encode, svg: svg }
})()
if (typeof module !== 'undefined') module.exports = QR
