<template>
  <section class="panel">
    <div class="sec-header">
      <div class="sec-title-row">
        <span class="sec-icon">🏥</span>
        <div>
          <h2 class="sec-title">{{ store.myCenterId ? "Mon centre de santé" : "Créer mon centre" }}</h2>
          <p class="sec-sub">{{ store.chefForm.name || "Aucun centre créé pour le moment" }}</p>
        </div>
      </div>
      <span class="sec-status-badge" :class="statusBadgeClass">{{ statusLabel }}</span>
    </div>

    <p v-if="store.chefError" class="error">{{ store.chefError }}</p>
    <p v-if="store.chefSuccess" class="success">{{ store.chefSuccess }}</p>

    <article v-if="!store.myCenterId && !skipCodeClaim" class="mc-card">
      <h3 class="mc-card-title">Code de l'établissement</h3>
      <p class="muted">
        Si votre établissement existe déjà dans la base (import officiel), entrez son code pour récupérer ses informations. Sinon, créez un nouveau centre.
      </p>
      <div class="mc-field">
        <label for="mc-claim-code">Code établissement</label>
        <input
          id="mc-claim-code"
          v-model="store.claimCodeInput"
          placeholder="Code établissement"
          style="text-transform: uppercase"
          @input="store.claimError = ''; store.claimNotFound = false"
        />
      </div>
      <p v-if="store.claimError" class="error">{{ store.claimError }}</p>
      <template v-if="store.claimNotFound">
        <p class="error">Aucun centre trouvé avec ce code.</p>
        <button type="button" @click="store.createWithClaimCode(); skipCodeClaim = true">
          Créer un nouveau centre avec ce code
        </button>
      </template>
      <div class="mc-actions">
        <button type="button" class="secondary" @click="skipCodeClaim = true">Créer sans code</button>
        <button type="button" :disabled="store.claimLoading" @click="store.claimCenterByCode">
          {{ store.claimLoading ? "Vérification..." : "Vérifier le code" }}
        </button>
      </div>
    </article>

    <article v-else-if="store.myCenterId && !isEditingCenter" class="mc-card">
      <div class="mc-summary-head">
        <h3 class="mc-card-title">Informations du centre</h3>
        <button type="button" @click="isEditingCenter = true">Modifier</button>
      </div>
      <div class="mc-summary-row"><span>Nom</span><strong>{{ store.chefForm.name || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Adresse</span><strong>{{ store.chefForm.address || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Code établissement</span><strong>{{ store.chefForm.establishmentCode || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Région</span><strong>{{ regionLabel || "-" }}</strong></div>
      <div class="mc-summary-row"><span>District</span><strong>{{ districtLabel || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Niveau</span><strong>{{ levelLabel || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Type</span><strong>{{ typeLabel || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Plateau technique</span><strong>{{ store.chefForm.technicalPlatform || "-" }}</strong></div>
      <div class="mc-summary-row"><span>Services</span><strong>{{ servicesLabel || "-" }}</strong></div>
      <div class="mc-summary-row"><span>GPS</span><strong>{{ store.chefForm.latitude }}, {{ store.chefForm.longitude }}</strong></div>
    </article>

    <form v-else class="card-list" @submit.prevent="submitCenter">
      <article class="mc-card">
        <h3 class="mc-card-title">Informations générales</h3>
        <div class="mc-field">
          <label for="mc-name">Nom du centre</label>
          <input id="mc-name" v-model="store.chefForm.name" placeholder="Nom du centre" required />
        </div>
        <div class="mc-field">
          <label for="mc-address">Adresse</label>
          <input id="mc-address" v-model="store.chefForm.address" placeholder="Adresse" required />
        </div>
        <div class="mc-field">
          <label for="mc-code">Code établissement (optionnel)</label>
          <input id="mc-code" v-model="store.chefForm.establishmentCode" placeholder="Ex: ABIDJAN-001" />
        </div>
      </article>

      <article class="mc-card">
        <h3 class="mc-card-title">Localisation</h3>
        <div class="mc-field-grid">
          <div class="mc-field">
            <label for="mc-region">Région</label>
            <select id="mc-region" v-model="store.chefForm.regionCode" required @change="store.onChefRegionChange">
              <option value="">- Sélectionner une région -</option>
              <option v-for="r in store.regions" :key="r.code" :value="r.code">{{ r.code }} - {{ r.name }}</option>
            </select>
          </div>
          <div class="mc-field">
            <label for="mc-district">Ville / district (optionnel)</label>
            <select id="mc-district" v-model="store.chefForm.districtCode">
              <option value="">- Ville (optionnel) -</option>
              <option v-for="d in store.availableDistrictsForChef" :key="d.code" :value="d.code">{{ d.code }} - {{ d.name }}</option>
            </select>
          </div>
        </div>
      </article>

      <article class="mc-card">
        <h3 class="mc-card-title">Classification</h3>
        <div class="mc-field-grid">
          <div class="mc-field">
            <label for="mc-level">Niveau d'établissement</label>
            <select id="mc-level" v-model="store.chefForm.level" required>
              <option value="CHU">CHU</option>
              <option value="CHR">CHR</option>
              <option value="CH">CH</option>
              <option value="CHS">CHS</option>
              <option value="CLINIQUE">Clinique</option>
              <option value="POLYCLINIQUE">Polyclinique</option>
              <option value="INFIRMERIE">Infirmerie</option>
              <option value="CLCC">CLCC</option>
              <option value="ESPC">ESPC</option>
              <option value="CENTRE_SANTE">Centre de santé</option>
              <option value="SSR">SSR</option>
              <option value="EHPAD_USLD">EHPAD / USLD</option>
              <option value="CENTRE_RADIOTHERAPIE">Centre de radiothérapie</option>
              <option value="CENTRE_CARDIOLOGIE">Centre de cardiologie</option>
            </select>
          </div>
          <div class="mc-field">
            <label for="mc-type">Type d'établissement</label>
            <select id="mc-type" v-model="store.chefForm.establishmentType" required>
              <option value="CONFESSIONNEL">Confessionnel</option>
              <option value="PRIVE">Privé</option>
              <option value="PUBLIQUE">Publique</option>
            </select>
          </div>
        </div>
      </article>

      <article class="mc-card">
        <h3 class="mc-card-title">Plateau technique & services</h3>
        <div class="mc-field">
          <label for="mc-platform">Plateau technique</label>
          <textarea id="mc-platform" v-model="store.chefForm.technicalPlatform" placeholder="Plateau technique" required />
        </div>

        <div class="services-editor">
          <div class="services-editor-head">
            <span>Services</span>
            <button type="button" class="secondary" @click="store.addChefServiceRow">+ Ajouter un service</button>
          </div>
          <div v-for="(service, index) in store.chefForm.services" :key="index" class="service-row">
            <input v-model="service.name" placeholder="Nom du service (ex: Urgences)" />
            <input v-model="service.description" placeholder="Description (optionnel)" />
            <div class="service-beds">
              <label>
                Lits disponibles
                <input v-model.number="service.bedsAvailable" type="number" min="0" />
              </label>
              <label>
                Lits occupés
                <input v-model.number="service.bedsOccupied" type="number" min="0" />
              </label>
              <label>
                Hors service
                <input v-model.number="service.bedsOutOfService" type="number" min="0" />
              </label>
              <button type="button" class="ghost danger" @click="store.removeChefServiceRow(index)">Retirer</button>
            </div>
          </div>
          <p v-if="store.chefForm.services.length === 0" class="muted">Aucun service ajouté.</p>
        </div>
      </article>

      <article class="mc-card">
        <h3 class="mc-card-title">Coordonnées GPS</h3>
        <div class="mc-field-grid">
          <div class="mc-field">
            <label for="mc-lat">Latitude</label>
            <input id="mc-lat" v-model.number="store.chefForm.latitude" type="number" step="any" placeholder="Latitude" required />
          </div>
          <div class="mc-field">
            <label for="mc-lon">Longitude</label>
            <input id="mc-lon" v-model.number="store.chefForm.longitude" type="number" step="any" placeholder="Longitude" required />
          </div>
        </div>
        <button type="button" class="secondary" @click="store.setCurrentPosition">📍 Utiliser ma position</button>
      </article>

      <div class="mc-actions">
        <p class="muted">Après création/modification, le centre passe en attente de validation.</p>
        <div class="mc-actions-buttons">
          <button v-if="store.myCenterId" type="button" class="secondary" @click="isEditingCenter = false">Annuler</button>
          <button type="submit">{{ store.myCenterId ? "Mettre à jour" : "Créer mon centre" }}</button>
        </div>
      </div>
    </form>

    <article v-if="store.myCenterId && !isEditingCenter" class="mc-card">
      <h3 class="mc-card-title">Places disponibles</h3>
      <p v-if="store.serviceError" class="error">{{ store.serviceError }}</p>
      <p v-if="(store.chefForm.services || []).length === 0" class="muted">Aucun service enregistré pour ce centre.</p>
      <div v-for="service in store.chefForm.services" :key="service.name" class="service-live-card">
        <template v-if="editingServiceName === service.name">
          <div class="mc-field">
            <label>Nom du service</label>
            <input v-model="serviceEditDraft.name" placeholder="Nom du service" />
          </div>
          <div class="mc-field">
            <label>Description</label>
            <input v-model="serviceEditDraft.description" placeholder="Description (optionnel)" />
          </div>
          <div class="mc-field">
            <label>Places disponibles</label>
            <input v-model.number="serviceEditDraft.bedsAvailable" type="number" min="0" />
          </div>
          <div class="mc-actions-buttons">
            <button type="button" class="secondary" @click="editingServiceName = ''">Annuler</button>
            <button
              type="button"
              :disabled="store.serviceActionLoadingName === service.name"
              @click="saveServiceEdit"
            >
              {{ store.serviceActionLoadingName === service.name ? "..." : "Enregistrer" }}
            </button>
          </div>
        </template>
        <template v-else>
          <div class="service-live-head">
            <strong>{{ service.name }}</strong>
            <span class="sec-status-badge" :class="service.bedsAvailable > 0 ? 'badge-success' : 'badge-new'">
              {{ service.bedsAvailable > 0 ? `${service.bedsAvailable} place(s)` : "Complet" }}
            </span>
          </div>
          <p class="muted">Occupées : {{ service.bedsOccupied }} · Hors service : {{ service.bedsOutOfService }}</p>
          <div class="mc-actions-buttons">
            <button
              type="button"
              class="secondary"
              :disabled="store.serviceActionLoadingName === service.name || service.bedsAvailable <= 0"
              @click="store.adjustServiceBeds(service.name, 'occupy')"
            >
              Occuper une place
            </button>
            <button
              type="button"
              class="secondary"
              :disabled="store.serviceActionLoadingName === service.name || service.bedsOccupied <= 0"
              @click="store.adjustServiceBeds(service.name, 'free')"
            >
              Libérer une place
            </button>
            <button type="button" class="secondary" @click="startEditService(service)">Modifier</button>
          </div>
        </template>
      </div>
    </article>

    <p v-if="!store.hasApprovedChefCenter" class="muted mc-notice">
      Les notes et la gestion des plaintes seront disponibles après approbation du centre.
    </p>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useDashboardStore } from "../../stores/dashboard";

const store = useDashboardStore();
const skipCodeClaim = ref(false);
const isEditingCenter = ref(false);
const editingServiceName = ref("");
const serviceEditDraft = ref({ name: "", description: "", bedsAvailable: 0 });

function startEditService(service) {
  editingServiceName.value = service.name;
  serviceEditDraft.value = {
    name: service.name,
    description: service.description || "",
    bedsAvailable: service.bedsAvailable ?? 0,
  };
  store.serviceError = "";
}

async function saveServiceEdit() {
  const targetName = editingServiceName.value;
  await store.updateServiceDetails(targetName, {
    name: serviceEditDraft.value.name.trim(),
    description: serviceEditDraft.value.description.trim(),
    bedsAvailable: Number(serviceEditDraft.value.bedsAvailable) || 0,
  });
  if (!store.serviceError) editingServiceName.value = "";
}

const APPROVAL_CFG = {
  APPROVED: { label: "Approuvé", cls: "badge-success" },
  PENDING: { label: "En attente", cls: "badge-in-progress" },
  REJECTED: { label: "Rejeté", cls: "badge-new" },
};

const LEVEL_LABELS = {
  CHU: "CHU", CHR: "CHR", CH: "CH", CHS: "CHS",
  CLINIQUE: "Clinique", POLYCLINIQUE: "Polyclinique", INFIRMERIE: "Infirmerie", CLCC: "CLCC", ESPC: "ESPC",
  CENTRE_SANTE: "Centre de santé", SSR: "SSR", EHPAD_USLD: "EHPAD / USLD",
  CENTRE_RADIOTHERAPIE: "Centre de radiothérapie", CENTRE_CARDIOLOGIE: "Centre de cardiologie",
};
const TYPE_LABELS = { CONFESSIONNEL: "Confessionnel", PRIVE: "Privé", PUBLIQUE: "Publique" };

const regionLabel = computed(() => {
  const r = store.regions.find((item) => item.code === store.chefForm.regionCode);
  return r ? `${r.code} - ${r.name}` : "";
});
const districtLabel = computed(() => {
  const d = store.districts.find((item) => item.code === store.chefForm.districtCode);
  return d ? `${d.code} - ${d.name}` : "";
});
const levelLabel = computed(() => LEVEL_LABELS[store.chefForm.level] || "");
const typeLabel = computed(() => TYPE_LABELS[store.chefForm.establishmentType] || "");
const servicesLabel = computed(() =>
  (store.chefForm.services || []).map((s) => s.name).filter(Boolean).join(", ")
);

async function submitCenter() {
  await store.saveMyCenter();
  if (!store.chefError) isEditingCenter.value = false;
}

const currentApprovalStatus = computed(() => {
  if (!store.myCenterId) return "";
  const center = store.allCenters.find((c) => String(c._id) === String(store.myCenterId));
  return String(center?.approvalStatus || "").toUpperCase();
});

const statusLabel = computed(() => {
  if (!store.myCenterId) return "Non créé";
  return APPROVAL_CFG[currentApprovalStatus.value]?.label || "Statut inconnu";
});

const statusBadgeClass = computed(() => {
  if (!store.myCenterId) return "badge-closed";
  return APPROVAL_CFG[currentApprovalStatus.value]?.cls || "badge-closed";
});
</script>

<style scoped>
.panel {
  padding: 24px;
}

.sec-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.sec-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sec-icon {
  font-size: 2.2rem;
  line-height: 1;
}

.sec-title {
  margin: 0 0 2px;
  font-size: 1.4rem;
  font-weight: 800;
  color: #0d2f57;
}

.sec-sub {
  margin: 0;
  font-size: 0.85rem;
  color: #5a7aa8;
  font-weight: 600;
}

.sec-status-badge {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge-new         { background: #fdecec; color: #c0392b; }
.badge-in-progress { background: #fef9e7; color: #b07700; }
.badge-success      { background: #eafaf1; color: #1a7a4a; }
.badge-closed       { background: #f0f0f0; color: #666; }

.card-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mc-card {
  border-radius: 14px;
  border: 1.5px solid #e0e8f5;
  background: #fff;
  padding: 16px 18px;
  box-shadow: 0 2px 10px rgba(10, 50, 100, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mc-card-title {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7a95bc;
}

.mc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mc-field label {
  font-size: 0.78rem;
  font-weight: 700;
  color: #2c4a72;
}

.mc-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.mc-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-radius: 14px;
  background: #f7faff;
  border: 1px solid #dce8f5;
}

.mc-actions-buttons {
  display: flex;
  gap: 10px;
}

.mc-summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mc-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #eef3fa;
  font-size: 0.88rem;
}

.mc-summary-row span {
  color: #7a95bc;
  font-weight: 600;
}

.mc-summary-row strong {
  color: #1a3a6e;
  text-align: right;
}

.mc-notice {
  margin-top: 14px;
}

.service-live-card {
  border-radius: 10px;
  border: 1px solid #e0e8f5;
  background: #f7faff;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.service-live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.services-editor {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.services-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: var(--gray-700);
}
.service-row {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--gray-50);
  border-radius: 8px;
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
  font-size: 12px;
  color: var(--gray-500);
}
.service-beds input {
  width: 90px;
}
</style>
