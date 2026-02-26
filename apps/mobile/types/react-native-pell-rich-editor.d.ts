import 'react-native-pell-rich-editor';

declare module 'react-native-pell-rich-editor' {
  interface RichEditorProps {
    onLinkPress?: (url: string) => void;
  }
}
