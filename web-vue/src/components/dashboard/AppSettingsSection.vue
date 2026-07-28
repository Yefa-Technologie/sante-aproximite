<template>
  <section class="panel">
    <h2>Parametres de l'application</h2>
    <p class="muted">
      Ces reglages controlent des fonctionnalites de l'application mobile a distance,
      sans necessiter de nouvelle publication.
    </p>

    <p v-if="store.appSettingsError" class="error">{{ store.appSettingsError }}</p>
    <p v-if="store.appSettingsSuccess" class="success">{{ store.appSettingsSuccess }}</p>

    <div class="setting-row">
      <div class="setting-copy">
        <strong>Afficher notation, satisfaction et "J'ai visite ce centre"</strong>
        <p class="muted">
          Quand ce reglage est active, les boutons de notation, de satisfaction et de
          declaration de visite apparaissent dans l'app mobile complete pour les onglets
          "Par region/district" et "Par ville" (jamais dans "A proximite"). Quand il est
          desactive, ces boutons n'apparaissent dans aucun onglet.
        </p>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          :checked="store.appSettings.centerReviewsEnabled"
          :disabled="store.appSettingsLoading"
          @change="store.updateAppSetting('centerReviewsEnabled', $event.target.checked)"
        />
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </label>
    </div>

    <h2 class="modules-title">Modules actifs par role</h2>
    <p class="muted">
      Activez ou desactivez l'acces a chaque module, pour chaque role, sur l'application mobile
      choisie ci-dessous. Un module desactive pour un role disparait de cette application des que
      l'appareil resynchronise ses reglages (au demarrage ou en tache de fond). Les deux applications
      ont des reglages independants.
    </p>

    <div class="app-tabs">
      <button
        v-for="app in store.appDefinitions.length ? store.appDefinitions : [{ key: 'mobile', label: 'Mobile' }, { key: 'mobile-minima', label: 'Mobile Minima' }]"
        :key="app.key"
        type="button"
        class="app-tab"
        :class="{ active: store.moduleSettingsApp === app.key }"
        @click="store.setModuleSettingsApp(app.key)"
      >
        {{ app.label }}
      </button>
    </div>

    <p v-if="store.moduleSettingsError" class="error">{{ store.moduleSettingsError }}</p>

    <div class="modules-table-wrap">
      <table class="modules-table">
        <thead>
          <tr>
            <th class="modules-table-head">Module</th>
            <th v-for="role in store.roleDefinitions" :key="role.key">{{ role.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mod in store.moduleDefinitions" :key="mod.key">
            <td class="modules-table-head">{{ mod.label }}</td>
            <td v-for="role in store.roleDefinitions" :key="role.key">
              <input
                type="checkbox"
                :checked="store.moduleSettingsMatrix[mod.key]?.[role.key] !== false"
                :disabled="store.moduleSettingsLoading"
                @change="store.updateModuleSetting(mod.key, role.key, $event.target.checked)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { onMounted } from "vue";
import { useDashboardStore } from "../../stores/dashboard";
const store = useDashboardStore();

onMounted(() => {
  store.fetchAppSettings();
  store.fetchModuleSettings();
});
</script>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  margin-top: 16px;
}
.setting-copy { max-width: 480px; }
.setting-copy strong { display: block; margin-bottom: 4px; }

.switch { position: relative; display: inline-block; width: 46px; height: 26px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch-track {
  position: absolute;
  inset: 0;
  background: #cbd5e1;
  border-radius: 999px;
  transition: background 0.15s ease;
  display: block;
}
.switch input:checked + .switch-track { background: #179657; }
.switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.switch input:checked + .switch-track .switch-thumb { transform: translateX(20px); }

.modules-title { margin-top: 28px; }

.app-tabs { display: flex; gap: 8px; margin-top: 12px; }
.app-tab {
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid var(--border, #e2e8f0);
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  color: var(--gray-700, #334155);
  cursor: pointer;
}
.app-tab.active { background: #dc2626; border-color: #dc2626; color: #fff; }

.modules-table-wrap {
  margin-top: 12px;
  overflow-x: auto;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
}
.modules-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.modules-table th, .modules-table td {
  padding: 10px 14px;
  text-align: center;
  white-space: nowrap;
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.modules-table th { font-weight: 700; background: var(--surface-muted, #f8fafc); }
.modules-table .modules-table-head { text-align: left; font-weight: 600; }
.modules-table tbody tr:last-child td { border-bottom: none; }
</style>
