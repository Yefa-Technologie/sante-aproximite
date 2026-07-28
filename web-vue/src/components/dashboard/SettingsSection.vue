<template>
  <section class="panel settings-panel">
    <h2>Parametres</h2>
    <p class="settings-intro">
      Administration des comptes, du referentiel territorial et des centres de sante.
    </p>

    <!-- KPI row -->
    <div class="settings-kpi-row">
      <article class="settings-kpi">
        <p>Utilisateurs</p>
        <h3>{{ store.users.length }}</h3>
      </article>
      <article class="settings-kpi">
        <p>Chefs en attente</p>
        <h3>{{ store.pendingChefsCount }}</h3>
      </article>
      <article class="settings-kpi">
        <p>Comptes desactives</p>
        <h3>{{ store.disabledUsersCount }}</h3>
      </article>
      <article class="settings-kpi">
        <p>Centres en attente</p>
        <h3>{{ store.pendingCenters.length }}</h3>
      </article>
    </div>

    <!-- Section switch -->
    <div class="settings-switch">
      <button
        type="button"
        class="ghost settings-switch-btn"
        :class="{ active: store.settingsSection === 'users' }"
        @click="store.settingsSection = 'users'"
      >
        Gestion des utilisateurs
        <span class="settings-badge">{{ store.users.length }}</span>
      </button>
      <button
        type="button"
        class="ghost settings-switch-btn"
        :class="{ active: store.settingsSection === 'centers' }"
        @click="switchToCenters"
      >
        Gestion des centres
        <span class="settings-badge">{{ store.allCenters.length }}</span>
      </button>
      <button
        v-if="canSeeCentersTab"
        type="button"
        class="ghost settings-switch-btn settings-switch-btn-alert"
        :class="{ active: store.settingsSection === 'pending-centers' }"
        @click="openPendingCentersOverview"
      >
        Centres en attente
        <span class="settings-badge">{{ store.pendingCenters.length }}</span>
      </button>
      <button
        v-if="store.isDeveloper"
        type="button"
        class="ghost settings-switch-btn"
        :class="{ active: store.settingsSection === 'app-settings' }"
        @click="store.settingsSection = 'app-settings'"
      >
        Réglages
      </button>
    </div>

    <!-- ── USERS ── -->
    <div v-if="store.settingsSection === 'users'">
      <UsersMgmtSection />
    </div>

    <!-- ── USERS (old, hidden) ── -->
    <div v-if="false" class="settings-users-layout">
      <article class="card settings-card">
        <form class="form-grid" @submit.prevent="store.createUser">
          <input v-model="store.userForm.fullName" placeholder="Nom complet" required />
          <input v-model="store.userForm.email" type="email" placeholder="Email" required />
          <input
            v-model="store.userForm.password"
            type="password"
            :placeholder="store.editingUserId ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'"
            :required="!store.editingUserId"
          />
          <select v-model="store.userForm.primaryRole">
            <option value="USER">Role principal: Utilisateur</option>
            <option value="NATIONAL">Role principal: National</option>
            <option value="REGION">Role principal: Region</option>
            <option value="DISTRICT">Role principal: District</option>
            <option value="ETABLISSEMENT">Role principal: Etablissement</option>
            <option value="SAPEUR_POMPIER">Role principal: Sapeur-Pompier</option>
            <option value="SAMU">Role principal: SAMU</option>
            <option value="POLICE">Role principal: Police</option>
            <option value="GENDARMERIE">Role principal: Gendarmerie</option>
            <option value="PROTECTION_CIVILE">Role principal: Protection Civile</option>
            <option value="REGULATOR">Role principal: Regulateur (legacy)</option>
          </select>
          <label>Roles supplementaires</label>
          <div class="role-chip-group">
            <label
              v-for="roleOption in store.userRoleOptions"
              :key="roleOption"
              class="role-chip-item"
            >
              <input
                type="checkbox"
                :value="roleOption"
                :checked="store.userForm.roles.includes(roleOption)"
                @change="store.toggleUserRole(roleOption)"
              />
              <span>{{ store.formatUserRoleLabel(roleOption) }}</span>
            </label>
          </div>
          <input
            v-if="store.requiresEstablishmentCode"
            v-model="store.userForm.establishmentCode"
            placeholder="Code de l'etablissement"
            required
          />
          <select v-model="store.userForm.regionCode">
            <option value="">Affectation region (optionnel)</option>
            <option
              v-for="region in store.regions"
              :key="`user_region_${region.code}`"
              :value="region.code"
            >
              {{ region.code }} - {{ region.name }}
            </option>
          </select>
          <select v-model="store.userForm.districtCode">
            <option value="">Affectation district (optionnel)</option>
            <option
              v-for="district in store.availableDistrictsForUserAssignment"
              :key="`user_district_${district.code}`"
              :value="district.code"
            >
              {{ district.code }} - {{ district.name }}
            </option>
          </select>
          <select v-model="store.userForm.centerId">
            <option value="">Affectation centre (optionnel)</option>
            <option
              v-for="center in store.assignableCentersForUser"
              :key="`user_center_${center._id}`"
              :value="String(center._id)"
            >
              {{ center.name }} ({{ center.establishmentCode || "sans code" }})
            </option>
          </select>
          <div class="actions">
            <button type="submit">
              {{ store.editingUserId ? "Mettre a jour" : "Ajouter" }}
            </button>
            <button
              v-if="store.editingUserId"
              type="button"
              class="ghost"
              @click="store.resetUserForm"
            >
              Annuler
            </button>
          </div>
        </form>
        <p v-if="store.usersError" class="error">{{ store.usersError }}</p>
        <p v-if="store.usersSuccess" class="success">{{ store.usersSuccess }}</p>
      </article>

      <!-- Users table -->
      <article class="card settings-card">
        <div class="settings-table-header">
          <div>
            <h3 class="settings-card-title">Utilisateurs</h3>
            <p class="muted settings-card-subtitle">
              {{ store.filteredUsers.length }} / {{ store.users.length }} compte(s)
            </p>
          </div>
          <button type="button" class="secondary" @click="store.fetchUsers">Actualiser</button>
        </div>
        <div class="settings-user-filters">
          <input
            v-model="store.usersSearch"
            type="text"
            placeholder="Rechercher (nom, email, role, affectation)"
          />
          <div class="settings-filter-chips">
            <button
              v-for="item in store.userCategoryMenu"
              :key="item.key"
              type="button"
              class="ghost settings-filter-chip"
              :class="{ active: store.userCategory === item.key }"
              @click="store.userCategory = item.key"
            >
              {{ item.label }}
              <span class="settings-badge">{{ store.userCategoryCounts[item.key] || 0 }}</span>
            </button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="users-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Role</th>
                <th>Affectation</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in store.paginatedUsers" :key="u.id">
                <td>{{ u.fullName }}</td>
                <td>{{ u.email }}</td>
                <td>{{ Array.isArray(u.roles) ? u.roles.join(", ") : u.role }}</td>
                <td>{{ store.formatUserScope(u) }}</td>
                <td>
                  {{ u.isActive === false ? "DESACTIVE" : (u.approvalStatus || "ACTIF") }}
                </td>
                <td>
                  <div class="user-actions-wrap">
                    <button
                      class="ghost user-actions-toggle"
                      :class="{ active: expandedUserId === u.id }"
                      @click="expandedUserId = expandedUserId === u.id ? null : u.id"
                    >
                      Actions ▾
                    </button>
                    <div v-if="expandedUserId === u.id" class="user-actions-dropdown">
                      <button
                        v-if="(u.role === 'ETABLISSEMENT' || u.role === 'CHEF_ETABLISSEMENT') && u.approvalStatus === 'PENDING'"
                        class="ghost"
                        @click="store.reviewChef(u.id, 'APPROVE'); expandedUserId = null"
                      >Approuver</button>
                      <button
                        v-if="(u.role === 'ETABLISSEMENT' || u.role === 'CHEF_ETABLISSEMENT') && u.approvalStatus === 'PENDING'"
                        class="ghost danger"
                        @click="store.reviewChef(u.id, 'REJECT'); expandedUserId = null"
                      >Rejeter</button>
                      <button class="ghost" @click="store.startEditUser(u); expandedUserId = null">Modifier</button>
                      <button
                        class="ghost"
                        :disabled="String(auth.state.user?.id) === String(u.id)"
                        @click="store.toggleUserActive(u); expandedUserId = null"
                      >{{ u.isActive === false ? "Activer" : "Désactiver" }}</button>
                      <button
                        class="ghost danger"
                        :disabled="String(auth.state.user?.id) === String(u.id)"
                        @click="store.deleteUser(u.id); expandedUserId = null"
                      >Supprimer</button>
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-if="store.filteredUsers.length === 0">
                <td colspan="6" class="muted">Aucun utilisateur pour ce filtre.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="store.usersPageCount > 1" class="actions">
          <button
            class="ghost"
            :disabled="store.usersPage <= 1"
            @click="store.usersPage = Math.max(1, store.usersPage - 1)"
          >
            Precedent
          </button>
          <span class="muted">Page {{ store.usersPage }} / {{ store.usersPageCount }}</span>
          <button
            class="ghost"
            :disabled="store.usersPage >= store.usersPageCount"
            @click="store.usersPage = Math.min(store.usersPageCount, store.usersPage + 1)"
          >
            Suivant
          </button>
        </div>
      </article>
    </div>

    <!-- ── GESTION DES CENTRES ── -->
    <div v-else-if="store.settingsSection === 'centers'">
      <CentersAdminSection />
    </div>

    <!-- ── CENTRES EN ATTENTE ── -->
    <div v-else-if="store.settingsSection === 'pending-centers' && canSeeCentersTab" class="settings-grid settings-centers-layout">
      <article class="card settings-card settings-card-span-2">
        <div class="settings-table-header">
          <div>
            <h3 class="settings-card-title">Centres en attente par region et district</h3>
            <p class="muted settings-card-subtitle">
              Vue regroupee pour identifier rapidement les zones avec le plus de validations en attente.
            </p>
          </div>
        </div>
        <div class="card-list">
          <article
            v-for="regionGroup in pendingCentersByRegion"
            :key="regionGroup.regionCode"
            class="card"
          >
            <h4>
              {{ formatRegionLabel(regionGroup.regionCode) }} - {{ regionGroup.count }} centre(s)
            </h4>
            <div
              v-for="districtGroup in regionGroup.districts"
              :key="`${regionGroup.regionCode}_${districtGroup.districtCode}`"
              class="settings-pending-zone"
            >
              <strong>{{ formatDistrictLabel(districtGroup.districtCode) }}</strong>
              <span class="muted">{{ districtGroup.count }} centre(s)</span>
              <ul class="settings-pending-zone-list">
                <li
                  v-for="center in districtGroup.centers"
                  :key="center._id"
                >
                  <div class="settings-pending-center-line">
                    <span>
                      {{ center.name }}<span v-if="center.establishmentCode"> - {{ center.establishmentCode }}</span>
                    </span>
                    <span class="settings-pending-center-actions">
                      <button type="button" @click="store.reviewCenter(center._id, 'APPROVE')">Approuver</button>
                      <button type="button" class="ghost danger" @click="store.reviewCenter(center._id, 'REJECT')">Rejeter</button>
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </article>
          <p v-if="pendingCentersByRegion.length === 0" class="muted">
            Aucun centre en attente.
          </p>
        </div>
      </article>
    </div>

    <!-- ── REGLAGES APPLICATION ── -->
    <div v-else-if="store.settingsSection === 'app-settings' && store.isDeveloper">
      <AppSettingsSection />
    </div>

  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useDashboardStore } from "../../stores/dashboard";
import { useAuthStore } from "../../stores/auth";
import UsersMgmtSection from "./UsersMgmtSection.vue";
import CentersAdminSection from "./CentersAdminSection.vue";
import AppSettingsSection from "./AppSettingsSection.vue";

const store = useDashboardStore();
const auth = useAuthStore();
const expandedUserId = ref(null);
const canSeeCentersTab = computed(() => store.isRegulator);

function formatRegionLabel(regionCode) {
  const code = String(regionCode || "").trim().toUpperCase();
  const match = (store.regions || []).find((region) => String(region.code || "").trim().toUpperCase() === code);
  if (match?.name && code) return `${match.name} (${code})`;
  return match?.name || code || "SANS_REGION";
}

function formatDistrictLabel(districtCode) {
  const code = String(districtCode || "").trim().toUpperCase();
  const match = (store.districts || []).find((district) => String(district.code || "").trim().toUpperCase() === code);
  if (match?.name && code) return `${match.name} (${code})`;
  return match?.name || code || "SANS_DISTRICT";
}

function openPendingCentersOverview() {
  store.settingsSection = "pending-centers";
}

async function switchToCenters() {
  store.settingsSection = "centers";
  if (store.allCenters.length === 0) await store.fetchAllCenters();
  if (store.regions.length === 0) await store.fetchRegions();
  if (store.districts.length === 0) await store.fetchDistricts();
}

const pendingCentersByRegion = computed(() => {
  const groups = new Map();

  for (const center of store.pendingCenters || []) {
    const regionCode = String(center?.regionCode || "SANS_REGION").trim().toUpperCase();
    const districtCode = String(center?.districtCode || "SANS_DISTRICT").trim().toUpperCase();

    if (!groups.has(regionCode)) {
      groups.set(regionCode, {
        regionCode,
        count: 0,
        districts: new Map(),
      });
    }

    const regionGroup = groups.get(regionCode);
    regionGroup.count += 1;

    if (!regionGroup.districts.has(districtCode)) {
      regionGroup.districts.set(districtCode, {
        districtCode,
        count: 0,
        centers: [],
      });
    }

    const districtGroup = regionGroup.districts.get(districtCode);
    districtGroup.count += 1;
    districtGroup.centers.push(center);
  }

  return Array.from(groups.values())
    .map((regionGroup) => ({
      regionCode: regionGroup.regionCode,
      count: regionGroup.count,
      districts: Array.from(regionGroup.districts.values()).sort((a, b) =>
        a.districtCode.localeCompare(b.districtCode)
      ),
    }))
    .sort((a, b) => a.regionCode.localeCompare(b.regionCode));
});
</script>

<style scoped>
.settings-switch-btn-alert {
  border-color: #f59e0b;
  background: #fff7ed;
  color: #9a3412;
}

.settings-switch-btn-alert:hover {
  background: #ffedd5;
}

.settings-pending-zone {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.settings-pending-zone:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.settings-pending-zone-list {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #475569;
}

.settings-pending-center-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.settings-pending-center-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ── User actions dropdown ── */
.user-actions-wrap { position: relative; display: inline-block; }
.user-actions-toggle {
  font-size: 0.78rem; padding: 5px 10px; white-space: nowrap;
  border-radius: 8px; font-weight: 700;
}
.user-actions-toggle.active { background: #EFF6FF; border-color: #1A56DB; color: #1A56DB; }
.user-actions-dropdown {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 100;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px; min-width: 150px;
}
.user-actions-dropdown .ghost {
  text-align: left; border-radius: 8px; font-size: 0.82rem;
  padding: 7px 12px; white-space: nowrap;
}
.user-actions-dropdown .ghost:hover { background: #F8FAFF; }
.user-actions-dropdown .danger { color: #DC2626; }
.user-actions-dropdown .danger:hover { background: #FEF2F2; }

@media (max-width: 960px) {
  .settings-switch {
    display: grid;
    grid-template-columns: 1fr;
  }

  .settings-switch-btn {
    width: 100%;
    justify-content: center;
  }

  .settings-centers-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .settings-kpi-row {
    grid-template-columns: 1fr 1fr;
  }

  .settings-table-header {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-user-filters,
  .actions,
  .grid2,
  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
  }

  .settings-panel .form-grid > input,
  .settings-panel .form-grid > select,
  .settings-panel .form-grid > textarea,
  .settings-panel .settings-user-filters > input,
  .settings-panel .actions > input {
    max-width: 100%;
    width: 100%;
    box-sizing: border-box;
  }

  .settings-pending-center-line {
    flex-direction: column;
    align-items: flex-start;
  }

  .settings-pending-center-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }

  .settings-pending-center-actions > button {
    width: 100%;
  }
}
</style>
