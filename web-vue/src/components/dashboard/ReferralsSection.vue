<template>
  <section class="panel">
    <div class="sec-header">
      <div class="sec-title-row">
        <span class="sec-icon">🚑</span>
        <div>
          <h2 class="sec-title">Orientations de patients</h2>
          <p class="sec-sub">Patients orientés vers votre centre par un autre professionnel</p>
        </div>
      </div>

      <div class="sec-stats">
        <div class="stat-chip stat-new">
          <span class="stat-num">{{ store.pendingReferrals.length }}</span>
          <span class="stat-lbl">En attente</span>
        </div>
        <div class="stat-chip stat-resolved">
          <span class="stat-num">{{ store.receivedReferrals.length }}</span>
          <span class="stat-lbl">Reçus</span>
        </div>
        <div class="stat-chip stat-rejected">
          <span class="stat-num">{{ store.rejectedReferrals.length }}</span>
          <span class="stat-lbl">Rejetés</span>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <button class="ml-auto" @click="store.fetchIncomingReferrals()">↺ Actualiser</button>
    </div>

    <p v-if="store.referralsError" class="error">{{ store.referralsError }}</p>
    <p v-if="store.referralsSuccess" class="success">{{ store.referralsSuccess }}</p>

    <div class="card-list">
      <article
        v-for="item in [...store.pendingReferrals, ...store.receivedReferrals, ...store.rejectedReferrals]"
        :key="item.id"
        class="sec-card"
        :class="item.status === 'PENDING' ? 'card-new' : item.status === 'REJECTED' ? 'card-rejected' : 'card-resolved'"
      >
        <div class="sec-card-head">
          <div class="sec-card-type">
            <span class="sec-type-icon">🧑‍⚕️</span>
            <strong>{{ item.patientName || item.patientPhone }}</strong>
          </div>
          <span
            class="sec-status-badge"
            :class="item.status === 'PENDING' ? 'badge-new' : item.status === 'REJECTED' ? 'badge-rejected' : 'badge-success'"
          >
            {{ item.status === 'PENDING' ? 'En attente' : item.status === 'REJECTED' ? 'Rejeté' : 'Reçu' }}
          </span>
        </div>

        <div class="sec-card-body">
          <div class="sec-field-grid">
            <div class="sec-field">
              <span class="sec-field-lbl">Téléphone patient</span>
              <span class="sec-field-val">{{ item.patientPhone }}</span>
            </div>
            <div class="sec-field">
              <span class="sec-field-lbl">Orienté par</span>
              <span class="sec-field-val">{{ item.originUserName || "-" }}</span>
            </div>
            <div class="sec-field" v-if="item.serviceName">
              <span class="sec-field-lbl">Service</span>
              <span class="sec-field-val">{{ item.serviceName }}</span>
            </div>
            <div class="sec-field" v-if="item.reason">
              <span class="sec-field-lbl">Motif</span>
              <span class="sec-field-val">{{ item.reason }}</span>
            </div>
            <div class="sec-field">
              <span class="sec-field-lbl">Orienté le</span>
              <span class="sec-field-val">{{ formatDate(item.createdAt) }}</span>
            </div>
            <div class="sec-field" v-if="item.receivedAt && item.status !== 'REJECTED'">
              <span class="sec-field-lbl">Reçu le</span>
              <span class="sec-field-val">{{ formatDate(item.receivedAt) }}</span>
            </div>
            <div class="sec-field" v-if="item.status === 'REJECTED' && item.receivedAt">
              <span class="sec-field-lbl">Rejeté le</span>
              <span class="sec-field-val">{{ formatDate(item.receivedAt) }}</span>
            </div>
            <div class="sec-field" v-if="item.rejectionReason">
              <span class="sec-field-lbl">Motif du rejet</span>
              <span class="sec-field-val">{{ item.rejectionReason }}</span>
            </div>
          </div>
        </div>

        <div class="actions" v-if="item.status === 'PENDING'">
          <template v-if="rejectingId === item.id">
            <input
              v-model="rejectDrafts[item.id]"
              type="text"
              placeholder="Motif du rejet"
              class="reject-input"
            />
            <button class="btn-outline" @click="rejectingId = null">Annuler</button>
            <button
              class="btn-danger"
              :disabled="store.referralActionLoadingId === String(item.id)"
              @click="submitReject(item)"
            >
              {{ store.referralActionLoadingId === String(item.id) ? "..." : "Confirmer le rejet" }}
            </button>
          </template>
          <template v-else>
            <button
              :disabled="store.referralActionLoadingId === String(item.id)"
              @click="store.confirmReferralReception(item)"
            >
              {{ store.referralActionLoadingId === String(item.id) ? "..." : "Confirmer la réception" }}
            </button>
            <button class="btn-danger" @click="rejectingId = item.id">Rejeter</button>
          </template>
        </div>
      </article>

      <p v-if="store.pendingReferrals.length === 0 && store.receivedReferrals.length === 0 && store.rejectedReferrals.length === 0" class="muted">
        Aucune orientation pour votre centre.
      </p>
    </div>
  </section>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useDashboardStore } from "../../stores/dashboard";

const store = useDashboardStore();
const rejectingId = ref(null);
const rejectDrafts = reactive({});

function submitReject(item) {
  store.rejectReferralReception(item, rejectDrafts[item.id]);
  rejectingId.value = null;
}

function formatDate(raw) {
  if (!raw) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(raw));
  } catch {
    return String(raw);
  }
}
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

.sec-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 18px;
  border-radius: 12px;
  min-width: 72px;
}

.stat-num {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1;
}

.stat-lbl {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 3px;
}

.stat-new      { background: #fff4f4; border: 1px solid #f4c0c0; color: #c0392b; }
.stat-resolved { background: #f0fff8; border: 1px solid #7fd9b0; color: #1a7a4a; }
.stat-rejected { background: #f8f8f8; border: 1px solid #d0d0d0; color: #6b6b6b; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.ml-auto { margin-left: auto; }

.card-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sec-card {
  border-radius: 14px;
  border: 1.5px solid #e0e8f5;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(10, 50, 100, 0.06);
}

.sec-card.card-new      { border-left: 5px solid #e74c3c; }
.sec-card.card-resolved { border-left: 5px solid #27ae60; opacity: 0.9; }
.sec-card.card-rejected { border-left: 5px solid #9ca3af; opacity: 0.9; }

.sec-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  border-bottom: 1px solid #edf2fa;
}

.sec-card-type {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.05rem;
  color: #1a3a6e;
}

.sec-type-icon {
  font-size: 1.3rem;
}

.sec-status-badge {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.badge-new     { background: #fdecec; color: #c0392b; }
.badge-success { background: #eafaf1; color: #1a7a4a; }
.badge-rejected { background: #f1f1f1; color: #6b6b6b; }

.sec-card-body {
  padding: 14px 18px;
}

.sec-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px 16px;
}

.sec-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sec-field-lbl {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7a95bc;
}

.sec-field-val {
  font-size: 0.9rem;
  color: #1a3a6e;
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  padding: 10px 18px 14px;
  border-top: 1px solid #edf2fa;
}

.reject-input {
  flex: 1;
  min-width: 160px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #e0e8f5;
  font-size: 0.85rem;
}

.btn-danger {
  background: #fdecec;
  color: #c0392b;
  border: 1px solid #f4c0c0;
}

.btn-outline {
  background: #fff;
  color: #5a7aa8;
  border: 1px solid #e0e8f5;
}
</style>
