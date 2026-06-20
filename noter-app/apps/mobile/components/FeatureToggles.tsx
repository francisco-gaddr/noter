import React, { useEffect, useState } from 'react';
import { List, Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { defaultFeatureSettings, type FeatureSettings } from '@repo/shared';
import { getFeatureSettings, saveFeatureSettings } from '@/services/featureSettings';

/** Settings section for the creative features (parity with web FeatureToggles). On/off per feature;
 *  AI features get a source/model picker as each lands. */
export function FeatureToggles() {
  const { t } = useTranslation();
  const [s, setS] = useState<FeatureSettings>(defaultFeatureSettings());

  useEffect(() => { getFeatureSettings().then(setS).catch(() => {}); }, []);

  const update = (patch: Partial<FeatureSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void saveFeatureSettings(next);
  };

  return (
    <List.Section>
      <List.Subheader>{t('features.title')}</List.Subheader>
      <List.Item
        title={t('features.autoLink.label')}
        description={t('features.autoLink.hint')}
        right={() => <Switch value={s.autoLink.enabled} onValueChange={(v) => update({ autoLink: { enabled: v } })} />}
      />
    </List.Section>
  );
}
