declare module 'react-icons/fa' {
  import type { ComponentType, SVGAttributes } from 'react';

  export type IconBaseProps = SVGAttributes<SVGElement> & {
    size?: string | number;
    color?: string;
    title?: string;
  };

  export type IconType = ComponentType<IconBaseProps>;

  export const FaBars: IconType;
  export const FaBell: IconType;
  export const FaBold: IconType;
  export const FaCalendar: IconType;
  export const FaCheckCircle: IconType;
  export const FaCheckSquare: IconType;
  export const FaChevronDown: IconType;
  export const FaChevronRight: IconType;
  export const FaCode: IconType;
  export const FaCog: IconType;
  export const FaColumns: IconType;
  export const FaComments: IconType;
  export const FaCopy: IconType;
  export const FaExclamationCircle: IconType;
  export const FaFileAlt: IconType;
  export const FaFileDownload: IconType;
  export const FaFilePdf: IconType;
  export const FaFilter: IconType;
  export const FaFolder: IconType;
  export const FaFolderOpen: IconType;
  export const FaImage: IconType;
  export const FaIndent: IconType;
  export const FaItalic: IconType;
  export const FaLink: IconType;
  export const FaList: IconType;
  export const FaListOl: IconType;
  export const FaListUl: IconType;
  export const FaLock: IconType;
  export const FaMoon: IconType;
  export const FaPen: IconType;
  export const FaPlus: IconType;
  export const FaQuoteRight: IconType;
  export const FaRegCircle: IconType;
  export const FaRegSmile: IconType;
  export const FaSave: IconType;
  export const FaSearch: IconType;
  export const FaSignOutAlt: IconType;
  export const FaSort: IconType;
  export const FaSun: IconType;
  export const FaTable: IconType;
  export const FaTags: IconType;
  export const FaTimes: IconType;
  export const FaTrash: IconType;
  export const FaUnderline: IconType;
  export const FaUnlock: IconType;
  export const FaVideo: IconType;

  const icons: Record<string, IconType>;
  export default icons;
}
