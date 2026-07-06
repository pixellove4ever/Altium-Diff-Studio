import { DEFAULT_LOCALE, translate, type Locale, type MessageKey } from '$lib/i18n';

class LocaleStore {
	locale = $state<Locale>(DEFAULT_LOCALE);

	set(locale: Locale) {
		this.locale = locale;
		if (typeof window !== 'undefined') window.localStorage.setItem('ads:locale', locale);
	}

	t(key: MessageKey, variables: Record<string, string | number> = {}) {
		return translate(this.locale, key, variables);
	}
}

export const localeStore = new LocaleStore();
