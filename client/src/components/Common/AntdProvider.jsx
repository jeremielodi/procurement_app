// src/components/Common/AntdProvider.jsx
// Composants antd (Table…) : langue de l'interface (textes de pagination, tri, sélection) et couleurs de l'application.
// Langue sans traduction antd → anglais (repli des composants), les textes de l'app restent dans leurs fichiers.
import React from 'react';
import { ConfigProvider } from 'antd';
import frFR from 'antd/locale/fr_FR';
import enUS from 'antd/locale/en_US';
import { useTranslation } from '../../i18n';

const ANTD_LOCALES = { fr: frFR, en: enUS };

const THEME = {
  token: {
    colorPrimary: '#2563EB', // bleu de l'application (Tailwind blue-600)
    borderRadius: 8,
    fontFamily: 'inherit',
  },
  components: {
    Table: { headerBg: '#F9FAFB', headerColor: '#6B7280', rowHoverBg: '#F9FAFB' },
  },
};

export default function AntdProvider({ children }) {
  const { lang } = useTranslation();
  return (
    <ConfigProvider locale={ANTD_LOCALES[lang] || enUS} theme={THEME}>
      {children}
    </ConfigProvider>
  );
}
