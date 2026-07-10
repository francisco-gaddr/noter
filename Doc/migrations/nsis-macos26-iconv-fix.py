#!/usr/bin/env python3
"""Fix makensis' spurious `std::bad_alloc` on macOS 26 (unicode installers).

Root cause (isolated 2026-07-10 via crash-report backtrace + source instrumentation):
macOS 26 ships GNU libiconv as the system iconv. GNU's "wchar_t" codec is LOCALE-
DEPENDENT — in the C locale it rejects any non-ASCII character with EILSEQ, while
iconv_open() still succeeds (so you cannot probe your way around it). NSIS converts
every exe-head string through iconv("UTF-16LE" <- "wchar_t"); the first non-ASCII
string fails, WCToUTF16LEHlpr::Create returns false, and ExeHeadStringList::add
throws std::bad_alloc — which looks like an OOM but is a failed charset conversion.

The fix: never use the locale-dependent "wchar_t" encoding name. wchar_t's memory
layout is fixed per platform (UTF-32 host-endian on Apple), so name it explicitly.

Usage (from an unpacked nsis-3.12-src/ or nsis-3.11-src/ directory):
    python3 nsis-macos26-iconv-fix.py path/to/nsis-3.12-src
    cd path/to/nsis-3.12-src
    scons makensis SKIPUTILS=all SKIPPLUGINS=all SKIPDOC=all NSIS_CONFIG_CONST_DATA_PATH=no
    # binary at build/urelease/makensis/makensis; point NSISDIR at a full NSIS data
    # dir (e.g. Homebrew's /opt/homebrew/Cellar/makensis/3.12/share/nsis)

The installed result on Francisco's Mac lives at ~/tools/nsis-fixed/makensis (a wrapper
that sets NSISDIR and execs the patched binary). See the Tauri runbook §8a.
"""
import sys
from pathlib import Path

HELPER = '''
// macOS 26 ships GNU libiconv as the system iconv. GNU's "wchar_t" codec is locale-
// dependent: in the C locale it rejects any non-ASCII character with EILSEQ (and
// iconv_open still succeeds, so probing open() cannot detect it). wchar_t's memory
// layout is fixed per platform, so name the encoding explicitly instead.
const char* nsis_iconv_wchar_code()
{
  static const char* wc = 0;
  if (!wc)
  {
    if (4 == sizeof(wchar_t))
      wc = Platform_IsBigEndian() ? "UTF-32BE" : "UTF-32LE";
    else if (2 == sizeof(wchar_t))
      wc = Platform_IsBigEndian() ? "UTF-16BE" : "UTF-16LE";
    else
      wc = "wchar_t";
  }
  return wc;
}

const char* nsis_iconv_get_host_endian_ucs4_code()'''

def patch(root: Path) -> None:
    p = root / 'Source/util.cpp'
    s = p.read_text()
    assert 'nsis_iconv_get_host_endian_ucs4_code()' in s, 'unexpected util.cpp'
    s = s.replace('const char* nsis_iconv_get_host_endian_ucs4_code()', HELPER, 1)
    s = s.replace('#define NRT_TMP_IGHEUC(s) if (id.Open("wchar_t", (s))) return ucs4 = (s)',
                  '#define NRT_TMP_IGHEUC(s) if (id.Open(nsis_iconv_wchar_code(), (s))) return ucs4 = (s)')
    s = s.replace('id.Open("wchar_t", g_nrt_iconv_narrowloc)',
                  'id.Open(nsis_iconv_wchar_code(), g_nrt_iconv_narrowloc)')
    s = s.replace('iconv_open(cp, "wchar_t")', 'iconv_open(cp, nsis_iconv_wchar_code())')
    s = s.replace('iconv_open("wchar_t", cp)', 'iconv_open(nsis_iconv_wchar_code(), cp)')
    p.write_text(s)

    p = root / 'Source/util.h'
    s = p.read_text()
    s = s.replace('const char* nsis_iconv_get_host_endian_ucs4_code();',
                  'const char* nsis_iconv_get_host_endian_ucs4_code();\nconst char* nsis_iconv_wchar_code();')
    p.write_text(s)

    p = root / 'Source/utf.cpp'
    s = p.read_text()
    s = s.replace('iconvd.Open("wchar_t",iconvdescriptor::GetHostEndianUCS4Code())',
                  'iconvd.Open(nsis_iconv_wchar_code(),iconvdescriptor::GetHostEndianUCS4Code())')
    s = s.replace('iconvd.Open("wchar_t", iconvdescriptor::GetHostEndianUCS4Code())',
                  'iconvd.Open(nsis_iconv_wchar_code(), iconvdescriptor::GetHostEndianUCS4Code())')
    s = s.replace('if (IsWE(m_FE)) strcpy(f, "wchar_t");',
                  'if (IsWE(m_FE)) strcpy(f, nsis_iconv_wchar_code());')
    s = s.replace('if (IsWE(m_TE)) strcpy(t, "wchar_t");',
                  'if (IsWE(m_TE)) strcpy(t, nsis_iconv_wchar_code());')
    assert '"wchar_t"' not in s, 'utf.cpp still has literal wchar_t names'
    p.write_text(s)
    print(f'patched {root} OK')

if __name__ == '__main__':
    patch(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.'))
