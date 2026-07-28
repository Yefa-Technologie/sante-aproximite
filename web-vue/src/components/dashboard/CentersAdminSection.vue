<template>
  <div class="centers-admin">

    <!-- Toolbar -->
    <div class="ca-toolbar">
      <input
        v-model="store.centersAdminSearch"
        class="ca-search"
        placeholder="🔍 Rechercher par nom, code, adresse…"
      />
      <select v-model="store.centersAdminRegionFilter" class="ca-filter">
        <option value="">Toutes les régions</option>
        <option v-for="r in store.regions" :key="r.code" :value="r.code">
          {{ r.code }} – {{ r.name }}
        </option>
      </select>
      <select
        v-if="store.centersAdminRegionFilter"
        v-model="store.centersAdminDistrictFilter"
        class="ca-filter"
      >
        <option value="">Tous les districts</option>
        <option
          v-for="d in store.availableDistrictsForCenterAdminFilter"
          :key="d.code"
          :value="d.code"
        >
          {{ d.code }} – {{ d.name }}
        </option>
      </select>
      <span class="ca-count">{{ store.filteredCentersForAdmin.length }} centre(s)</span>
      <button class="ca-btn-create" @click="showGeoModal = true">🗺 Région / District</button>
      <button class="ca-btn-create ca-btn-create--center" @click="showCenterModal = true">🏥 Nouveau centre</button>
    </div>

    <!-- ══ Modale : Créer Région / District ══ -->
    <Teleport to="body">
      <div v-if="showGeoModal" class="ca-overlay" @click.self="showGeoModal = false">
        <div class="ca-modal">
          <h3 class="ca-modal-title">🗺 Régions et districts</h3>
          <p class="ca-modal-sub">Maintenez à jour la structure territoriale officielle.</p>

          <div v-if="store.geoError" class="ca-modal-msg ca-modal-err">{{ store.geoError }}</div>
          <div v-if="store.geoSuccess" class="ca-modal-msg ca-modal-ok">{{ store.geoSuccess }}</div>

          <form class="ca-modal-form" @submit.prevent="store.createRegion">
            <strong class="ca-modal-section-title">Créer une région</strong>
            <div class="ca-modal-row2">
              <input v-model="store.regionForm.code" placeholder="Code région (ex: ABIDJAN)" required />
              <input v-model="store.regionForm.name" placeholder="Nom de la région" required />
            </div>
            <button type="submit" class="ca-modal-submit">Créer la région</button>
          </form>

          <hr class="ca-modal-hr" />

          <form class="ca-modal-form" @submit.prevent="store.createDistrict">
            <strong class="ca-modal-section-title">Créer un district</strong>
            <select v-model="store.districtForm.regionCode" required>
              <option value="">- Sélectionner une région -</option>
              <option v-for="r in store.regions" :key="r.code" :value="r.code">
                {{ r.code }} – {{ r.name }}
              </option>
            </select>
            <div class="ca-modal-row2">
              <input v-model="store.districtForm.code" placeholder="Code district" required />
              <input v-model="store.districtForm.name" placeholder="Nom du district" required />
            </div>
            <button type="submit" class="ca-modal-submit">Créer le district</button>
          </form>

          <div class="ca-modal-foot">
            <button class="ghost" @click="showGeoModal = false">Fermer</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ Modale : Créer Centre de Santé ══ -->
    <Teleport to="body">
      <div v-if="showCenterModal" class="ca-overlay" @click.self="showCenterModal = false">
        <div class="ca-modal ca-modal--lg">
          <h3 class="ca-modal-title">🏥 Nouveau centre de santé</h3>
          <p class="ca-modal-sub">Créez un établissement avec sa région, son district et ses coordonnées GPS.</p>

          <div v-if="store.regulatorCenterError" class="ca-modal-msg ca-modal-err">{{ store.regulatorCenterError }}</div>
          <div v-if="store.regulatorCenterSuccess" class="ca-modal-msg ca-modal-ok">{{ store.regulatorCenterSuccess }}</div>

          <form class="ca-modal-form" @submit.prevent="submitNewCenter">
            <div class="ca-modal-row2">
              <div class="ca-mf-row">
                <label>Nom *</label>
                <input v-model="store.regulatorCenterForm.name" placeholder="Nom de l'établissement" required />
              </div>
              <div class="ca-mf-row">
                <label>Adresse *</label>
                <input v-model="store.regulatorCenterForm.address" placeholder="Adresse" required />
              </div>
              <div class="ca-mf-row">
                <label>Code établissement</label>
                <input v-model="store.regulatorCenterForm.establishmentCode" placeholder="Code (optionnel)" />
              </div>
              <div class="ca-mf-row">
                <label>Niveau *</label>
                <select v-model="store.regulatorCenterForm.level" required>
                  <option value="CHU">CHU</option>
                  <option value="CHR">CHR</option>
                  <option value="CH">CH</option>
                  <option value="CHS">CHS</option>
                  <option value="CLINIQUE">Clinique</option>
                  <option value="POLYCLINIQUE">Polyclinique</option>
                  <option value="INFIRMERIE">Infirmerie</option>
                  <option value="CLCC">CLCC</option>
                  <option value="ESPC">ESPC</option>
                  <option value="CENTRE_SANTE">Centre de Santé</option>
                  <option value="SSR">SSR</option>
                  <option value="EHPAD_USLD">EHPAD / USLD</option>
                  <option value="CENTRE_RADIOTHERAPIE">Centre de Radiothérapie</option>
                  <option value="CENTRE_CARDIOLOGIE">Centre de Cardiologie</option>
                </select>
              </div>
              <div class="ca-mf-row">
                <label>Type *</label>
                <select v-model="store.regulatorCenterForm.establishmentType" required>
                  <option value="PUBLIQUE">Public</option>
                  <option value="PRIVE">Privé</option>
                  <option value="CONFESSIONNEL">Confessionnel</option>
                </select>
              </div>
              <div class="ca-mf-row">
                <label>Région *</label>
                <select v-model="store.regulatorCenterForm.regionCode" required @change="store.onRegulatorRegionChange">
                  <option value="">- Sélectionner une région -</option>
                  <option v-for="r in store.regions" :key="r.code" :value="r.code">
                    {{ r.code }} – {{ r.name }}
                  </option>
                </select>
              </div>
              <div class="ca-mf-row">
                <label>Ville</label>
                <select v-model="store.regulatorCenterForm.districtCode">
                  <option value="">- Optionnel -</option>
                  <option v-for="d in store.availableDistrictsForRegulatorCenter" :key="d.code" :value="d.code">
                    {{ d.code }} – {{ d.name }}
                  </option>
                </select>
              </div>
              <div class="ca-mf-row">
                <label>Plateforme technique *</label>
                <input v-model="store.regulatorCenterForm.technicalPlatform" placeholder="Plateau technique" required />
              </div>
            </div>

            <div class="services-editor">
              <div class="services-editor-head">
                <span>Services</span>
                <button type="button" class="secondary" @click="store.addRegulatorServiceRow">+ Ajouter un service</button>
              </div>
              <div v-for="(service, index) in store.regulatorCenterForm.services" :key="index" class="service-row">
                <input v-model="service.name" placeholder="Nom du service (ex: Urgences)" />
                <input v-model="service.description" placeholder="Description (optionnel)" />
                <div class="service-beds">
                  <label>
                    Lits disponibles
                    <input v-model.number="service.bedsAvailable" type="number" min="0" />
                  </label>
                  <label>
                    Lits occupes
                    <input v-model.number="service.bedsOccupied" type="number" min="0" />
                  </label>
                  <label>
                    Hors service
                    <input v-model.number="service.bedsOutOfService" type="number" min="0" />
                  </label>
                  <button type="button" class="ghost danger" @click="store.removeRegulatorServiceRow(index)">Retirer</button>
                </div>
              </div>
              <p v-if="store.regulatorCenterForm.services.length === 0" class="muted">Aucun service ajoute.</p>
            </div>

            <div class="ca-modal-row2 ca-modal-row2--gps">
              <div class="ca-mf-row">
                <label>Latitude *</label>
                <input v-model.number="store.regulatorCenterForm.latitude" type="number" step="any" placeholder="Latitude GPS" required />
              </div>
              <div class="ca-mf-row">
                <label>Longitude *</label>
                <input v-model.number="store.regulatorCenterForm.longitude" type="number" step="any" placeholder="Longitude GPS" required />
              </div>
            </div>

            <div class="ca-modal-foot">
              <button type="button" class="ghost" @click="store.setRegulatorCurrentPosition">📍 Ma position GPS</button>
              <button type="submit" class="ca-modal-submit">Créer l'établissement</button>
              <button type="button" class="ghost" @click="showCenterModal = false">Annuler</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <p v-if="store.centersAdminError" class="error">{{ store.centersAdminError }}</p>
    <p v-if="store.centersAdminSuccess" class="success">{{ store.centersAdminSuccess }}</p>

    <!-- Liste -->
    <div class="ca-list">
      <article
        v-for="center in store.paginatedCentersForAdmin"
        :key="center._id"
        class="ca-card"
        :class="{ 'ca-card--inactive': center.isActive === false, 'ca-card--expanded': isExpanded(center) }"
      >
        <!-- En-tête cliquable -->
        <div class="ca-card-head" @click="store.toggleCenterAdminDetails(center)">
          <div class="ca-card-identity">
            <span class="ca-card-icon">🏥</span>
            <div>
              <p class="ca-card-name">{{ center.name }}</p>
              <p class="ca-card-meta">
                <span class="ca-badge ca-badge--level">{{ formatLevel(center.level) }}</span>
                <span class="ca-badge ca-badge--type">{{ formatType(center.establishmentType) }}</span>
                <span v-if="center.isActive === false" class="ca-badge ca-badge--inactive">Désactivé</span>
                <span v-else class="ca-badge ca-badge--active">Actif</span>
              </p>
            </div>
          </div>
          <div class="ca-card-summary">
            <span class="ca-card-code">{{ center.establishmentCode || "–" }}</span>
            <span class="ca-card-region">{{ regionLabel(center.regionCode) }}</span>
            <span class="ca-card-chevron">{{ isExpanded(center) ? "▲" : "▼" }}</span>
          </div>
        </div>

        <!-- Détails / Formulaire d'édition -->
        <div v-if="isExpanded(center)" class="ca-card-body">

          <!-- Mode lecture -->
          <div v-if="!isEditing(center)" class="ca-detail-grid">
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Adresse</span>
              <span class="ca-detail-val">{{ center.address || "–" }}</span>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Plateforme technique</span>
              <span class="ca-detail-val">{{ center.technicalPlatform || "–" }}</span>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Région</span>
              <span class="ca-detail-val">{{ regionLabel(center.regionCode) }}</span>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Ville</span>
              <span class="ca-detail-val">{{ districtLabel(center.districtCode) }}</span>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Coordonnées GPS</span>
              <span class="ca-detail-val">
                {{ centerLat(center) }}, {{ centerLon(center) }}
              </span>
            </div>
            <div class="ca-detail-field ca-detail-field--wide">
              <span class="ca-detail-lbl">Services</span>
              <span class="ca-detail-val" v-if="!center.services?.length">–</span>
              <ul v-else class="ca-service-list">
                <li v-for="(s, i) in center.services" :key="i">
                  {{ s.name }}
                  <span class="ca-service-beds">
                    ({{ s.bedsAvailable || 0 }} dispo / {{ s.bedsOccupied || 0 }} occupe(s) / {{ s.bedsOutOfService || 0 }} hors service)
                  </span>
                </li>
              </ul>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Statut approbation</span>
              <span class="ca-detail-val">{{ center.approvalStatus || "–" }}</span>
            </div>
            <div class="ca-detail-field">
              <span class="ca-detail-lbl">Créé le</span>
              <span class="ca-detail-val">{{ formatDate(center.createdAt) }}</span>
            </div>
          </div>

          <!-- Mode édition -->
          <form v-else class="ca-edit-form" @submit.prevent="store.saveCenterByRegulator()">
            <div class="ca-form-row">
              <label>Nom</label>
              <input v-model="store.centerAdminForm.name" required />
            </div>
            <div class="ca-form-row">
              <label>Adresse</label>
              <input v-model="store.centerAdminForm.address" required />
            </div>
            <div class="ca-form-row">
              <label>Code établissement</label>
              <input v-model="store.centerAdminForm.establishmentCode" placeholder="Ex: ETB-001" />
            </div>
            <div class="ca-form-row">
              <label>Niveau</label>
              <select v-model="store.centerAdminForm.level">
                <option value="CHU">CHU</option>
                <option value="CHR">CHR</option>
                <option value="CH">CH</option>
                <option value="CHS">CHS</option>
                <option value="CLINIQUE">Clinique</option>
                <option value="POLYCLINIQUE">Polyclinique</option>
                <option value="INFIRMERIE">Infirmerie</option>
                <option value="CLCC">CLCC</option>
                <option value="ESPC">ESPC</option>
                <option value="CENTRE_SANTE">Centre de Santé</option>
                <option value="SSR">SSR</option>
                <option value="EHPAD_USLD">EHPAD / USLD</option>
                <option value="CENTRE_RADIOTHERAPIE">Centre de Radiothérapie</option>
                <option value="CENTRE_CARDIOLOGIE">Centre de Cardiologie</option>
              </select>
            </div>
            <div class="ca-form-row">
              <label>Type</label>
              <select v-model="store.centerAdminForm.establishmentType">
                <option value="PUBLIQUE">Public</option>
                <option value="PRIVE">Privé</option>
                <option value="CONFESSIONNEL">Confessionnel</option>
              </select>
            </div>
            <div class="ca-form-row">
              <label>Région</label>
              <select v-model="store.centerAdminForm.regionCode">
                <option value="">- Aucune -</option>
                <option v-for="r in store.regions" :key="r.code" :value="r.code">
                  {{ r.code }} – {{ r.name }}
                </option>
              </select>
            </div>
            <div class="ca-form-row">
              <label>Ville</label>
              <select v-model="store.centerAdminForm.districtCode">
                <option value="">- Aucun -</option>
                <option v-for="d in store.availableDistrictsForCenterAdminForm" :key="d.code" :value="d.code">
                  {{ d.code }} – {{ d.name }}
                </option>
              </select>
            </div>
            <div class="ca-form-row">
              <label>Plateforme technique</label>
              <input v-model="store.centerAdminForm.technicalPlatform" />
            </div>
            <div class="ca-form-row">
              <label>Services</label>
              <div class="services-editor">
                <div class="services-editor-head">
                  <span>{{ store.centerAdminForm.services.length }} service(s)</span>
                  <button type="button" class="secondary" @click="store.addCenterAdminServiceRow">+ Ajouter un service</button>
                </div>
                <div v-for="(service, index) in store.centerAdminForm.services" :key="index" class="service-row">
                  <input v-model="service.name" placeholder="Nom du service (ex: Urgences)" />
                  <input v-model="service.description" placeholder="Description (optionnel)" />
                  <div class="service-beds">
                    <label>
                      Lits disponibles
                      <input v-model.number="service.bedsAvailable" type="number" min="0" />
                    </label>
                    <label>
                      Lits occupes
                      <input v-model.number="service.bedsOccupied" type="number" min="0" />
                    </label>
                    <label>
                      Hors service
                      <input v-model.number="service.bedsOutOfService" type="number" min="0" />
                    </label>
                    <button type="button" class="ghost danger" @click="store.removeCenterAdminServiceRow(index)">Retirer</button>
                  </div>
                </div>
                <p v-if="store.centerAdminForm.services.length === 0" class="muted">Aucun service ajoute.</p>
              </div>
            </div>
            <div class="ca-form-row ca-form-row--two">
              <div>
                <label>Latitude</label>
                <input v-model="store.centerAdminForm.latitude" type="number" step="any" />
              </div>
              <div>
                <label>Longitude</label>
                <input v-model="store.centerAdminForm.longitude" type="number" step="any" />
              </div>
            </div>
            <div class="ca-form-actions">
              <button type="submit" :disabled="store.centersAdminActionLoading">
                {{ store.centersAdminActionLoading ? "Enregistrement…" : "Enregistrer" }}
              </button>
              <button type="button" class="ghost" @click="store.cancelEditCenterByRegulator()">
                Annuler
              </button>
            </div>
          </form>

          <!-- Actions -->
          <div class="ca-actions">
            <button
              v-if="!isEditing(center)"
              class="secondary"
              @click="store.startEditCenterByRegulator(center)"
            >
              ✏️ Modifier
            </button>
            <button
              class="ghost"
              :disabled="store.centersAdminActionLoading"
              @click="store.toggleCenterActiveByRegulator(center)"
            >
              {{ center.isActive === false ? "✅ Activer" : "⏸ Désactiver" }}
            </button>
            <button
              class="danger"
              :disabled="store.centersAdminActionLoading"
              @click="store.deleteCenterByRegulator(center)"
            >
              🗑 Supprimer
            </button>
          </div>
        </div>
      </article>

      <p v-if="store.filteredCentersForAdmin.length === 0" class="muted">
        Aucun centre trouvé.
      </p>
    </div>

    <!-- Pagination -->
    <div v-if="store.adminCentersPageCount > 1" class="ca-pagination">
      <button
        class="ghost"
        :disabled="store.adminCentersPage <= 1"
        @click="store.adminCentersPage--"
      >← Précédent</button>
      <span>{{ store.adminCentersPage }} / {{ store.adminCentersPageCount }}</span>
      <button
        class="ghost"
        :disabled="store.adminCentersPage >= store.adminCentersPageCount"
        @click="store.adminCentersPage++"
      >Suivant →</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useDashboardStore } from "../../stores/dashboard";

const store = useDashboardStore();

const showGeoModal    = ref(false);
const showCenterModal = ref(false);

const isExpanded = (center) => store.expandedCenterAdminId === String(center._id);
const isEditing  = (center) => store.editingCenterAdminId  === String(center._id);

function regionLabel(code) {
  if (!code) return "–";
  const match = (store.regions || []).find((r) => String(r.code || "").toUpperCase() === String(code).toUpperCase());
  return match ? `${match.name} (${match.code})` : code;
}

function districtLabel(code) {
  if (!code) return "–";
  const match = (store.districts || []).find((d) => String(d.code || "").toUpperCase() === String(code).toUpperCase());
  return match ? `${match.name} (${match.code})` : code;
}

async function submitNewCenter() {
  await store.createCenterByRegulator();
  if (!store.regulatorCenterError) showCenterModal.value = false;
}

const centerLat = (c) => c.location?.coordinates?.[1] ?? c.latitude ?? "–";
const centerLon = (c) => c.location?.coordinates?.[0] ?? c.longitude ?? "–";

function formatLevel(level) {
  const map = {
    CHU: "CHU", CHR: "CHR", CH: "CH", CHS: "CHS",
    CLINIQUE: "Clinique", POLYCLINIQUE: "Polyclinique", INFIRMERIE: "Infirmerie", CLCC: "CLCC", ESPC: "ESPC",
    CENTRE_SANTE: "Centre de Santé", SSR: "SSR", EHPAD_USLD: "EHPAD/USLD",
    CENTRE_RADIOTHERAPIE: "Radiothérapie", CENTRE_CARDIOLOGIE: "Cardiologie",
  };
  return map[String(level || "").toUpperCase()] || level || "–";
}

function formatType(type) {
  const map = { PUBLIQUE: "Public", PRIVE: "Privé", CONFESSIONNEL: "Confessionnel" };
  return map[String(type || "").toUpperCase()] || type || "–";
}

function formatDate(raw) {
  if (!raw) return "–";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(raw));
  } catch {
    return String(raw);
  }
}
</script>

<style scoped>
.centers-admin { padding: 0; }

.ca-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.ca-search {
  flex: 1;
  min-width: 200px;
  padding: 9px 14px;
  border: 1.5px solid #cfe2f7;
  border-radius: 10px;
  font-size: 0.93rem;
  background: #f7faff;
}

.ca-filter {
  padding: 9px 12px;
  border: 1.5px solid #cfe2f7;
  border-radius: 10px;
  font-size: 0.88rem;
  background: #f7faff;
  min-width: 160px;
}

.ca-count {
  font-size: 0.82rem;
  color: #5a7aa8;
  font-weight: 700;
  white-space: nowrap;
}

.ca-btn-create {
  padding: 9px 16px;
  border-radius: 10px;
  border: none;
  background: #1a6fc4;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.ca-btn-create:hover { background: #155aa0; }
.ca-btn-create--center { background: #179657; }
.ca-btn-create--center:hover { background: #127746; }

/* Overlay / Modal */
.ca-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 30, 60, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.ca-modal {
  background: #fff;
  border-radius: 18px;
  padding: 28px 32px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 24px 64px rgba(0,0,0,.22);
}

.ca-modal--lg { max-width: 680px; }

.ca-modal-title {
  font-size: 1.1rem;
  font-weight: 800;
  color: #0d2f57;
  margin: 0 0 4px;
}

.ca-modal-sub {
  font-size: 0.83rem;
  color: #64748b;
  margin: 0 0 18px;
}

.ca-modal-section-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: #1a3a6e;
  display: block;
  margin-bottom: 10px;
}

.ca-modal-hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }

.ca-modal-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ca-modal-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ca-modal-row2--gps { margin-top: 4px; }

.ca-mf-row { display: flex; flex-direction: column; gap: 4px; }
.ca-mf-row label {
  font-size: 0.73rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5a7aa8;
}
.ca-mf-row input,
.ca-mf-row select {
  padding: 8px 12px;
  border: 1.5px solid #cfe2f7;
  border-radius: 8px;
  font-size: 0.9rem;
  background: #f7faff;
}

.ca-modal-submit {
  background: #1a6fc4;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 22px;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  align-self: flex-start;
}
.ca-modal-submit:hover { background: #155aa0; }

.ca-modal-foot {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
  align-items: center;
}

.ca-modal-msg {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 12px;
}
.ca-modal-err { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.ca-modal-ok  { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }

.ca-list { display: flex; flex-direction: column; gap: 10px; }

.ca-card {
  border: 1.5px solid #e0e8f5;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
  transition: box-shadow 0.15s ease;
}

.ca-card:hover { box-shadow: 0 3px 14px rgba(10, 50, 100, 0.09); }
.ca-card--inactive { opacity: 0.72; border-color: #d4d4d4; }
.ca-card--expanded { border-color: #7ab3ef; box-shadow: 0 4px 18px rgba(10, 60, 130, 0.11); }

.ca-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  cursor: pointer;
  user-select: none;
  gap: 12px;
}

.ca-card-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.ca-card-icon { font-size: 1.6rem; flex-shrink: 0; }

.ca-card-name {
  margin: 0 0 4px;
  font-weight: 800;
  font-size: 1rem;
  color: #0d2f57;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ca-card-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0;
}

.ca-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ca-badge--level  { background: #eaf4ff; color: #1560a8; }
.ca-badge--type   { background: #f0f8f0; color: #2a7a3a; }
.ca-badge--active { background: #eafaf1; color: #1a7a4a; }
.ca-badge--inactive { background: #fff0f0; color: #c0392b; }

.ca-card-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  color: #5a7aa8;
  font-size: 0.85rem;
  font-weight: 600;
}

.ca-card-chevron { font-size: 0.75rem; color: #7a9cc8; }

.ca-card-body {
  border-top: 1px solid #e8f0fb;
  padding: 16px 18px 18px;
}

.ca-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px 20px;
  margin-bottom: 14px;
}

.ca-detail-field { display: flex; flex-direction: column; gap: 2px; }

.ca-detail-lbl {
  font-size: 0.71rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #7a95bc;
}

.ca-detail-val {
  font-size: 0.9rem;
  color: #1a3a6e;
  font-weight: 600;
}

/* Edit form */
.ca-edit-form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

.ca-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ca-form-row label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5a7aa8;
}

.ca-form-row input,
.ca-form-row select {
  padding: 8px 12px;
  border: 1.5px solid #cfe2f7;
  border-radius: 8px;
  font-size: 0.93rem;
  background: #f7faff;
}

.ca-form-row--two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex-direction: unset;
}

.ca-form-row--two label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5a7aa8;
  display: block;
  margin-bottom: 4px;
}

.ca-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

/* Actions bar */
.ca-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid #edf2fa;
  margin-top: 12px;
}

button.danger {
  background: linear-gradient(135deg, #e74c3c, #c0392b);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-weight: 700;
  cursor: pointer;
}

button.danger:disabled { opacity: 0.5; cursor: not-allowed; }

/* Services editor (create modal + edit form) */
.services-editor {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1.5px solid #cfe2f7;
  border-radius: 10px;
  background: #f7faff;
}
.services-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  color: #1a3a6e;
  font-size: 0.85rem;
}
.service-row {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border: 1px solid #e0e8f5;
  border-radius: 8px;
}
.service-row input {
  padding: 8px 12px;
  border: 1.5px solid #cfe2f7;
  border-radius: 8px;
  font-size: 0.9rem;
  background: #f7faff;
}
.service-beds {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.service-beds label {
  display: grid;
  gap: 4px;
  font-size: 0.72rem;
  color: #5a7aa8;
  font-weight: 600;
}
.service-beds input {
  width: 90px;
}

.ca-detail-field--wide { grid-column: 1 / -1; }
.ca-service-list { margin: 0; padding-left: 18px; }
.ca-service-list li { font-size: 0.9rem; color: #1a3a6e; font-weight: 600; }
.ca-service-beds { font-size: 0.78rem; color: #5a7aa8; font-weight: 500; }

/* Pagination */
.ca-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
  font-size: 0.9rem;
  color: #4a6d92;
}
</style>
