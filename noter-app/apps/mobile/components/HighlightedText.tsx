import React, { useMemo } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { highlightMatches } from '@/utils/searchHighlight';

/**
 * Render `text` with the supplied `terms` highlighted via the
 * pure `highlightMatches` tokeniser. Each matched run is styled
 * with `highlightStyle` (default: bold + tinted background).
 *
 * Why a component: the searchHighlight helper returns segments,
 * but callers consistently re-implement the "wrap matched runs
 * in a styled <Text>" loop. This component is the canonical
 * render for that loop.
 */
interface HighlightedTextProps extends TextProps {
  text: string;
  terms?: readonly string[];
  highlightStyle?: TextStyle;
}

const DEFAULT_HIGHLIGHT_STYLE: TextStyle = {
  fontWeight: '700',
  backgroundColor: 'rgba(208, 188, 255, 0.35)',
};

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  terms,
  highlightStyle,
  style,
  ...rest
}) => {
  const segments = useMemo(() => highlightMatches(text || '', terms || []), [text, terms]);
  if (segments.length === 0) return <Text style={style} {...rest}>{text}</Text>;
  return (
    <Text style={style} {...rest}>
      {segments.map((seg, i) => seg.match
        ? <Text key={i} style={[highlightStyle ?? DEFAULT_HIGHLIGHT_STYLE]}>{seg.text}</Text>
        : <Text key={i}>{seg.text}</Text>
      )}
    </Text>
  );
};
