/**
 * Headless replay harness for archived game records.
 *
 * Re-runs the deterministic core simulation over an archived game's turns
 * (the same pipeline a client uses when watching a replay) and compares the
 * recomputed state hashes against the hashes the server recorded during the
 * live game (each recorded hash was agreed on by every active client). Any
 * mismatch means a client replaying this record would see desync errors â€”
 * either the record is missing simulation inputs or the code has diverged
 * from the record's gitCommit.
 *
 * Usage:
 *   npm run replay:game -- <gameID | path/to/record.json>
 *                          [--api-base https://api.openfront.io]
 *                          [--teams 0,1,0,1]
 *                          [--rust-shadow]
 *
 * A bare game ID is fetched from the public API. --teams overrides each
 * player's teamIndex (in player order) â€” useful for records archived before
 * teamIndex was preserved (see GameServer.archiveGame), where team games
 * can only replay in sync with the original assignment supplied manually.
 *
 * --rust-shadow mirrors the real packed map-update stream into the Rust
 * WebAssembly map and verifies parity without changing authoritative state.
 * Build the module with `node scripts/build-rust-wasm.mjs` first.
 *
 * Exits non-zero if the replay, recorded hashes, or Rust map shadow diverge.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { RustMapShadow } from "../../src/core/rust/RustMapShadow";
import {
  GameRecord,
  GameRecordSchema,
  GameStartInfo,
} from "../../src/core/Schemas";
import {
  decompressGameRecord,
  simpleHash,
  toWireGameStartInfo,
} from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RUST_WASM_PATH = path.join(
  PROJECT_ROOT,
  "resources/wasm/openfront_wasm.wasm",
);

interface Options {
  source: string;
  apiBase: string;
  teams: number[] | null;
  rustShadow: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    source: "",
    apiBase: "https://api.openfront.io",
    teams: null,
    rustShadow: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--api-base":
        opts.apiBase = next();
        break;
      case "--teams":
        opts.teams = next()
          .split(",")
          .map((v) => parseInt(v, 10));
        break;
      case "--rust-shadow":
        opts.rustShadow = true;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
        opts.source = arg;
    }
  }
  if (opts.source === "") {
    throw new ErroŠ\ØYÙNˆ™\^N™Ø[YHKHØ[YRQ™XÛÜ™šœÛÛˆÛÜ[Ûœ×HŠNÂˆBˆ™]\›ˆÜÎÂŸB‚˜\Ş[˜È[˜İ[ÛˆØY™XÛÜ™
ÜÎˆÜ[ÛœÊNˆ›ÛZ\ÙOØ[YT™XÛÜ™ˆÂˆ]˜]Îˆ[šÛ›İÛÂˆYˆ
œË™^\İÔŞ[˜ÊÜËœÛİ\˜ÙJJHÂˆ˜]ÈH”ÓÓ‹œ\œÙJœËœ™XYš[TŞ[˜ÊÜËœÛİ\˜ÙK]ŠJNÂˆH[ÙHÂˆÛÛœİ\›H	ÛÜË˜\P˜\Ù_KÙØ[YKÉÛÜËœÛİ\˜Ù_XÂˆÛÛœÛÛK›ÙÊ™]Ú[™È	İ\›K‹‹˜
NÂˆÛÛœİ™\ÈH]ØZ]™]Ú
\›
NÂˆYˆ
\™\Ë›ÚÊHÂˆ›İÈ™]È\œ›ÜŠ˜Z[YÈ™]ÚØ[YH™XÛÜ™ˆ	Ü™\Ëœİ]\ßX
NÂˆBˆ˜]ÈH]ØZ]™\ËšœÛÛŠ
NÂˆBˆÛÛœİ\œÙYHØ[YT™XÛÜ™ØÚ[XKœØY™T\œÙJ˜]ÊNÂˆYˆ
\\œÙYœİXØÙ\ÜÊHÂˆËÈÛ\ˆ™XÛÜ™È™Y]HØÚ[XHYÚ[š[™ÜÎÈ™\^HÚ]ÙHØ[‹‚ˆÛÛœÛÛKØ\›ŠˆØ\›š[™Îˆ™XÛÜ™Ù\È›İ\œÙH[™\ˆHİ\œ™[Ø[YT™XÛÜ™ØÚ[XHˆ
ÂˆŠÛ™XÛÜ™ÊNÈ™\^Z[™È]\ËZ\Ëˆ‹ˆ
NÂˆ™]\›ˆ˜]È\ÈØ[YT™XÛÜ™ÂˆBˆ™]\›ˆ\œÙY™]NÂŸB‚˜\Ş[˜È[˜İ[ÛˆXZ[Š
Nˆ›ÛZ\ÙO›ÚYˆÂˆÛÛœİÜÈH\œÙP\™ÜÊ›ØÙ\ÜË˜\™İ‹œÛXÙJŠJNÂˆÛÛœÛÛK™XYÈH

HOˆßNÈËÈÚ[[˜ÙH\‹]XÚÈXYÈÙÙÚ[™Â‚ˆÛÛœİ™XÛÜ™HXÛÛ\™\ÜÑØ[YT™XÛÜ™
]ØZ]ØY™XÛÜ™
ÜÊJNÂˆÛÛœİ[™›ÈH™XÛÜ™š[™›ÎÂ‚ˆ]Ú]ÛÛ[Z]H[šÛ›İÛˆÂˆHÂˆÚ]ÛÛ[Z]H^XÔŞ[˜Ê™Ú]™]‹\\œÙHPQ‹ÂˆİÙˆ“Ò‘PÕÔ“ÓÕˆ[˜ÛÙ[™Îˆ]‹ˆJKš[J
NÂˆHØ]ÚÂˆËÈ›İHÚ]ÚXÚÛİ]ÈHZ\ÛX]ÚØ\›š[™È™[İÈÚ[š\™BˆBˆYˆ
™XÛÜ™™Ú]ÛÛ[Z]OOHÚ]ÛÛ[Z]
HÂˆÛÛœÛÛKØ\›ŠˆØ\›š[™Îˆ™XÛÜ™Ø\È^YYÛˆÛÛ[Z]	Ü™XÛÜ™™Ú]ÛÛ[Z]KÚXÚX^H
Âˆ›İX]ÚHÛÙH™Z[™È[‹ˆÚ[][][ÛˆÚ[™Ù\ÈÚ[˜ÙH]ÛÛ[Z]
ÂˆÚ[ÚİÈ\\È]™\™Ù[˜ÙK˜ˆ
NÂˆB‚ˆÛÛœİ^Y\œÈH[™›Ëœ^Y\œË›X\

JHOˆÂˆYˆ
ÜËX[\ÈOOH[
H™]\›ˆÂˆÛÛœİX[R[™^HÜËX[\ÖÚWNÂˆYˆ
X[R[™^OOH[™Yš[™Y[X™\‹š\Ó˜SŠX[R[™^
JHÂˆ›İÈ™]È\œ›ÜŠK]X[\È]\İ›İšYHÛ™H[™^\ˆ^Y\˜
NÂˆBˆ™]\›ˆÈ‹‹œX[R[™^NÂˆJNÂ‚ˆËÈØ[YHÚ\™H›[šÚ[™ÈHÛY[™\^H]\Y\È
ÙYHÕÚ\™QØ[YTİ\[™›ÊK‚ˆÛÛœİØ[YTİ\ˆØ[YTİ\[™›ÈHÕÚ\™QØ[YTİ\[™›ÊÂˆØ[YRQˆ[™›Ë™Ø[YRQˆØ˜PÜ™X]Y]ˆ[™›Ë›Ø˜PÜ™X]Y]ˆÛÛ™šYÎˆ[™›Ë˜ÛÛ™šYËˆ^Y\œËˆšX™\Îˆ[™›ËšX™\ËˆJNÂ‚ˆÛÛœÛÛK›ÙÊˆ™\^Z[™È	Ú[™›Ë™Ø[YRQNˆ	Ú[™›Ë˜ÛÛ™šYË™Ø[YSX\H
Âˆ
	Ú[™›Ë˜ÛÛ™šYË™Ø[YSX\Ú^™_JK	Ú[™›Ë˜ÛÛ™šYË™Ø[YS[Ù_K
Âˆ	Ü^Y\œË›[™İH^Y\œË	Ü™XÛÜ™\›œË›[™İH\›œØˆ
NÂ‚ˆËÈZ\œ›ÜœÈÜ™X]QØ[YT[›™\Š
HÚ]Hš[\Ş\İ[HX\ØY\‹‚ˆÛÛœİÛÛ™šYÈH™]ÈÛÛ™šYÊ[™›Ë˜ÛÛ™šYË[˜[ÙJNÂˆÛÛœİX\ØY\ˆH™]È›ÙQØ[YSX\ØY\Šˆ]š›Ú[Š“Ò‘PÕÔ“ÓÕœ™\Ûİ\˜Ù\ËÛX\ÈŠKˆ
NÂˆÛÛœİ\œ˜Z[ˆH]ØZ]ØY\œ˜Z[“X\
ˆ[™›Ë˜ÛÛ™šYË™Ø[YSX\ˆ[™›Ë˜ÛÛ™šYË™Ø[YSX\Ú^™KˆX\ØY\‹ˆ˜[ÙKˆ
NÂˆÛÛœİ˜[™ÛHH™]ÈÙ]YÔ˜[™ÛJÚ[\R\Ú
Ø[YTİ\™Ø[YRQ
JNÂˆÛÛœİ[X[œÈHØ[YTİ\œ^Y\œË›X\
ˆ

HO‚ˆ™]È^Y\’[™›Êˆ\Ù\›˜[YKˆ^Y\•\K’[X[‹ˆ˜ÛY[Qˆ˜[™ÛK›™^Q

Kˆš\ÓØ˜PÜ™X]ÜˆÏÈ˜[ÙKˆ˜Û[•YËˆ™œšY[™ÈÏÈ×KˆX[R[™^ÏÈ[ˆ
Kˆ
NÂˆÛÛœİ˜][ÛœÈHÜ™X]S˜][ÛœÑ›Ü‘Ø[YJˆØ[YTİ\ˆ\œ˜Z[‹›˜][ÛœËˆ\œ˜Z[‹˜Y][Û˜[˜][ÛœËˆ[X[œË›[™İˆ˜[™ÛKˆ
NÂˆÛÛœİØ[YHHÜ™X]QØ[YJˆ[X[œËˆ˜][ÛœËˆ\œ˜Z[‹™Ø[YSX\ˆ\œ˜Z[‹›Z[šQØ[YSX\ˆÛÛ™šYËˆ\œ˜Z[‹X[QØ[YTÜ]Û\™X\Ëˆ
NÂ‚ˆ]\İÚYİÎˆ\İX\ÚYİÈ[H[ÂˆYˆ
ÜËœ\İÚYİÊHÂˆYˆ
YœË™^\İÔŞ[˜Ê•TÕÕĞTÓWÔU
JHÂˆ›İÈ™]È\œ›ÜŠˆ\İÚYİÈ™\]Z\™\È	Ô•TÕÕĞTÓWÔUKˆ
Âˆ”[ˆ›ÙHØÜš\ËØZ[\\İ]Ø\ÛK›ZœØš\œİˆ‹ˆ
NÂˆBˆ\İÚYİÈH]ØZ]\İX\ÚYİË˜Ü™X]JˆØ[YK›X\

KˆœËœ™XYš[TŞ[˜Ê•TÕÕĞTÓWÔU
Kˆ
NÂˆÛÛœÛÛK›ÙÊ”\İX\ÚYİÈ[˜X›YˆŠNÂˆB‚ˆÛÛœİÛÛ\]Y\Ú\ÈH™]ÈX\[X™\‹[X™\Š
NÂˆ]˜][\œ›Üˆİš[™È[™Yš[™YÂˆ]ÚYİÑ\œ›Üˆ\œ›Üˆ[™Yš[™YÂˆÛÛœİ[›™\ˆH™]ÈØ[YT[›™\ŠˆØ[YKˆ™]È^Xİ]ÜŠˆØ[YKˆØ[YTİ\™Ø[YRQˆ[™Yš[™YˆØ[YTİ\šX™\ÏË›X\


HOˆ›˜[YJKˆ
Kˆ
İJHOˆÂˆYˆ
™\œ“\ÙÈˆ[ˆİJHÂˆ˜][\œ›ÜˆH	ÙİK™\œ“\ÙßW‰ÙİKœİXÚÈÏÈˆŸXÂˆ™]\›ÂˆBˆYˆ
\İÚYİÈOOH[	‰ˆÚYİÑ\œ›ÜˆOOH[™Yš[™Y
HÂˆHÂˆ\İÚYİË˜\TXÚÙY[U\]\ÊˆØ[YK›X\

KˆİKœXÚÙY[U\]\ËˆXÚÈ	ÙİKXÚßXˆ
NÂˆHØ]Ú
\œ›Üˆ[šÛ›İÛŠHÂˆÚYİÑ\œ›ÜˆBˆ\œ›Üˆ[œİ[˜Ù[Ùˆ\œ›ÜˆÈ\œ›Üˆˆ™]È\œ›ÜŠİš[™Ê\œ›ÜŠJNÂˆBˆBˆ›Üˆ
ÛÛœİHÙˆİK\]\ÖÑØ[YU\]U\K’\ÚH\È\Ú\]V×JHÂˆÛÛ\]Y\Ú\ËœÙ]
KXÚËKš\Ú
NÂˆBˆKˆ
NÂˆ[›™\‹š[š]

NÂ‚ˆÛÛœİ™XÛÜ™Y\Ú\ÈH™]ÈX\[X™\‹[X™\Š
NÂˆ›Üˆ
ÛÛœİ\›ˆÙˆ™XÛÜ™\›œÊHÂˆYˆ
\›‹š\ÚOOH[	‰ˆ\›‹š\ÚOOH[™Yš[™Y
HÂˆ™XÛÜ™Y\Ú\ËœÙ]
\›‹\›“[X™\‹\›‹š\Ú
NÂˆBˆBˆYˆ
™XÛÜ™Y\Ú\ËœÚ^™HOOH
HÂˆ\İÚYİÏË™\ÜÜÙJ
NÂˆ›İÈ™]È\œ›ÜŠœ™XÛÜ™ÛÛZ[œÈ›È\Ú\ÈÈ™\šYHYØZ[œİŠNÂˆB‚ˆÛÛœİİ\H\™›Ü›X[˜ÙK››İÊ
NÂˆ]š\œİZ\ÛX]Úˆ[X™\ˆ[H[Âˆ]X]Ú\ÈHÂˆ]ÛÛ\\™YHÂˆ]™\^PÛÛ\]YHYNÂ‚ˆHÂˆ›Üˆ
ÛÛœİ\›ˆÙˆ™XÛÜ™\›œÊHÂˆ[›™\‹˜Y\›Š\›ŠNÂˆYˆ
\[›™\‹™^Xİ]S™^XÚÊ
JHÂˆÛÛœÛÛK™\œ›ÜŠXÚÈ˜Z[Y]\›ˆ	İ\›‹\›“[X™\ŸN—‰Ù˜][\œ›ÜŸX
NÂˆ›ØÙ\ÜË™^]ÛÙHHNÂˆ™\^PÛÛ\]YH˜[ÙNÂˆœ™XZÎÂˆBˆYˆ
ÚYİÑ\œ›ÜˆOOH[™Yš[™Y
HÂˆ›İÈÚYİÑ\œ›ÜÂˆB‚ˆÛÛœİÛÛ\]YHÛÛ\]Y\Ú\Ë™Ù]
\›‹\›“[X™\ŠNÂˆÛÛœİ™XÛÜ™YH™XÛÜ™Y\Ú\Ë™Ù]
\›‹\›“[X™\ŠNÂˆYˆ
ÛÛ\]YOOH[™Yš[™Y	‰ˆ™XÛÜ™YOOH[™Yš[™Y
HÂˆ\İÚYİÏË˜\ÜÙ\[\š]JˆØ[YK›X\

Kˆ\ÚÚXÚÜÚ[	İ\›‹\›“[X™\ŸXˆ
NÂˆÛÛ\\™Y
ÊÎÂˆYˆ
ÛÛ\]YOOH™XÛÜ™Y
HÂˆX]Ú\ÊÊÎÂˆH[ÙHYˆ
š\œİZ\ÛX]ÚOOH[
HÂˆš\œİZ\ÛX]ÚH\›‹\›“[X™\ÂˆÛÛœÛÛK›ÙÊˆ’T”ÕRTÓPUÒ]\›ˆ	İ\›‹\›“[X™\ŸNˆ
ÂˆÛÛ\]Y	ØÛÛ\]YK™XÛÜ™Y	Ü™XÛÜ™YXˆ
NÂˆBˆBˆB‚ˆYˆ
™\^PÛÛ\]Y	‰ˆ\İÚYİÈOOH[
HÂˆ\İÚYİË˜\ÜÙ\[\š]JØ[YK›X\

K™š[˜[™\^Hİ]HŠNÂˆÛÛœÛÛK›ÙÊ”\İX\ÚYİÈ™[XZ[™Y[ˆŞ[˜ËˆŠNÂˆBˆHš[˜[HÂˆ\İÚYİÏË™\ÜÜÙJ
NÂˆB‚ˆÛÛœÛÛK›ÙÊˆÛÛ\\™Y	ØÛÛ\\™YH\ÚÚXÚÜÚ[È[ˆ
Âˆ	Ê
\™›Ü›X[˜ÙK››İÊ
HHİ\
HÈL
KÑš^Y
J_\Îˆ
Âˆ	ÛX]Ú\ßHX]Ú	ØÛÛ\\™YHX]Ú\ßHZ\ÛX]Ú˜ˆ
NÂˆYˆ
š\œİZ\ÛX]ÚOOH[
HÂˆÛÛœÛÛK›ÙÊ”™\^H\ÈSˆÖSÈÚ]H™XÛÜ™YØ[YKˆŠNÂˆH[ÙHÂˆÛÛœÛÛK›ÙÊ™\^HU‘T‘ÑQİ\[™È]\›ˆ	Ùš\œİZ\ÛX]ÚK˜
NÂˆ›ØÙ\ÜË™^]ÛÙHHNÂˆBŸB‚›XZ[Š
K˜Ø]Ú

\œŠHOˆÂˆÛÛœÛÛK™\œ›ÜŠ\œŠNÂˆ›ØÙ\ÜË™^]
JNÂŸJNÂ