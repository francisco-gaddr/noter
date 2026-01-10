import * as React from 'react';
import renderer, { act } from 'react-test-renderer';

import { MonoText } from '../StyledText';

it(`renders correctly`, () => {
  let root;
  act(() => {
    root = renderer.create(<MonoText>Snapshot test!</MonoText>);
  });
  expect(root.toJSON()).toMatchSnapshot();
  act(() => {
    root.unmount();
  });
});
