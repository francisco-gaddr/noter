import React from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, Button, useTheme, IconButton, Searchbar } from 'react-native-paper';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

interface IconPickerModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (icon: string) => void;
  currentIcon?: string;
}

// Common icons mapped to Fa* names used in web
const COMMON_ICONS = [
  'FaFolder', 'FaFolderOpen', 'FaFile', 'FaFileAlt', 'FaFileCode', 'FaFileImage', 'FaFilePdf',
  'FaBriefcase', 'FaClipboard', 'FaClipboardList', 'FaList', 'FaListAlt', 'FaListUl', 'FaListOl',
  'FaCheck', 'FaCheckCircle', 'FaCheckSquare', 'FaTimes', 'FaTimesCircle',
  'FaExclamation', 'FaExclamationCircle', 'FaExclamationTriangle',
  'FaInfo', 'FaInfoCircle', 'FaQuestion', 'FaQuestionCircle',
  'FaStar', 'FaHeart', 'FaBookmark', 'FaFlag',
  'FaHome', 'FaUser', 'FaUsers', 'FaCog', 'FaCogs', 'FaWrench',
  'FaCalendar', 'FaCalendarAlt', 'FaClock', 'FaBell',
  'FaSearch', 'FaLock', 'FaUnlock', 'FaKey',
  'FaTrash', 'FaTrashAlt', 'FaEdit', 'FaPen',
  'FaPlus', 'FaMinus', 'FaArrowRight', 'FaArrowLeft',
  'FaCode', 'FaTerminal', 'FaLaptop', 'FaMobile', 'FaTablet',
  'FaBook', 'FaBookOpen', 'FaGraduationCap',
  'FaChartBar', 'FaChartPie', 'FaChartLine',
  'FaMoneyBill', 'FaCreditCard', 'FaShoppingCart',
  'FaPlane', 'FaCar', 'FaBicycle', 'FaBus',
  'FaMusic', 'FaVideo', 'FaCamera', 'FaImage',
  'FaSmile', 'FaFrown', 'FaMeh',
];

export default function IconPickerModal({ visible, onDismiss, onSelect, currentIcon }: IconPickerModalProps) {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = React.useState('');

  const toFa5 = (faKey: string) => {
    const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
  };

  const filteredIcons = React.useMemo(() => {
    if (!searchQuery) return COMMON_ICONS;
    return COMMON_ICONS.filter(icon => 
      icon.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleMedium" style={styles.title}>Välj ikon</Text>
        
        <Searchbar
          placeholder="Sök ikon..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
          <View style={styles.row}>
            {filteredIcons.map((icon) => {
                const fa5Name = toFa5(icon);
                return (
                    <TouchableOpacity
                        key={icon}
                        style={[
                            styles.iconItem,
                            currentIcon === icon && { backgroundColor: theme.colors.primaryContainer }
                        ]}
                        onPress={() => onSelect(icon)}
                    >
                        <FontAwesome5 
                            name={fa5Name as any} 
                            size={24} 
                            color={currentIcon === icon ? theme.colors.primary : theme.colors.onSurface} 
                        />
                    </TouchableOpacity>
                );
            })}
          </View>
        </ScrollView>
        
        <Button onPress={onDismiss} style={styles.closeButton}>Stäng</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    padding: 20,
    margin: 20,
    borderRadius: 8,
    maxHeight: '80%',
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  searchBar: {
    marginBottom: 16,
    height: 40,
  },
  grid: {
    flexGrow: 1,
  },
  gridContent: {
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  iconItem: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  closeButton: {
    marginTop: 8,
  },
});
