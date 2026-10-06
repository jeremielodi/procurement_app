// Locale date-fns de la langue courante (formatDistanceToNow, format…)
// Nouvelle langue : ajouter sa locale date-fns ici (sinon français par défaut).
import { fr, enUS } from 'date-fns/locale';
import { getLang } from './index';

const LOCALES = { fr, en: enUS };

export const getDateFnsLocale = () => LOCALES[getLang()] || fr;
