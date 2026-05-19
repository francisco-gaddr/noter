import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { Text, IconButton, useTheme } from 'react-native-paper';
import { Note } from '@repo/shared';
import * as Haptics from 'expo-haptics';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useReduceMotion } from '@/hooks/useReduceMotion';

interface NoteItemProps {
  note: Note;
  level?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onPress: (note: Note) => void;
  onLongPress?: () => void;
  isActive?: boolean;
}

export const NoteItem: React.FC<NoteItemProps> = ({
  note,
  level = 0,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  onPress,
  onLongPress,
  isActive,
}) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();

  const toFa5 = (faKey: string) => {
    const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  };

  // Reanimated FadeIn on first mount. FlashList recycles components, so this
  // animation fires when a fresh tile scrolls into view (which is the intent —
  // new content fades in rather than snapping). We disable entirely when the
  // user has reduce-motion enabled so we never override OS accessibility.
  const enteringAnim = reduceMotion ? undefined : FadeIn.duration(140);

  // a11y: the row is a button that opens the note. The label combines title
  // + lock/folder state so screen-reader users get the meaning, not just
  // "Untitled". Hint describes the action; state.disabled reflects isActive.
  const a11yLabel = `${note.title || 'Untitled note'}${(note as any).locked ? ', locked' : ''}${(note as any).type === 'project' ? ', project' : ''}`;
  const a11yHint = hasChildren
    ? 'Double-tap to open. Long-press to reorder.'
    : 'Double-tap to open.';

  return (
    <Animated.View entering={enteringAnim}>
    <TouchableOpacity
      style={[
        styles.row,
        {
          paddingLeft: level * 20 + 10,
          backgroundColor: isActive ? theme.colors.elevation.level3 : theme.colors.surface,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={a11yHint}
      accessibilityState={{ disabled: !!isActive, expanded: hasChildren ? isExpanded : undefined }}
      onPress={() => {
        Haptics.selectionAsync();
        onPress(note);
      }}
      onLongPress={() => {
        if (onLongPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onLongPress();
        }
      }}
      disabled={isActive}
    >
      <View style={styles.iconContainer}>
        {hasChildren && onToggleExpand && (
          <IconButton
            icon={isExpanded ? 'chevron-down' : 'chevron-right'}
            size={20}
            onPress={() => onToggleExpand(note._id)}
            style={{ margin: 0 }}
            accessibilityLabel={isExpanded ? 'Collapse children' : 'Expand children'}
            accessibilityState={{ expanded: isExpanded }}
          />
        )}
      </View>

      <View style={{ width: 24, alignItems: 'center', marginRight: 8 }}>
        {(() => {
          const iconKey = (note as any).icon as string | undefined;

          if (iconKey) {
            return <FontAwesome5 name={toFa5(iconKey) as any} size={16} color={theme.colors.onSurface} />;
          }

          if ((note as any).type === 'project') {
            return <IconButton icon="folder-outline" size={20} style={{ margin: 0 }} iconColor={theme.colors.onSurface} />;
          }

          return <IconButton icon="file-document-outline" size={20} style={{ margin: 0 }} iconColor={theme.colors.onSurface} />;
        })()}
      </View>

      <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>
        {note.title}
      </Text>

      {note.locked && <IconButton icon="lock" size={16} style={{ margin: 0 }} />}
    </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  iconContainer: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 16,
    marginLeft: 5,
  },
});
