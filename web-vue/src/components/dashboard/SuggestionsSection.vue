<template>
  <section class="panel">
    <h2>Observations & suggestions</h2>

    <div class="stats-grid" v-if="store.suggestionSummary">
      <article class="stat-card">
        <h3>{{ store.suggestionSummary.total }}</h3>
        <p>Total</p>
      </article>
      <article class="stat-card">
        <h3>{{ store.suggestionSummary.unreadCount }}</h3>
        <p>Non lues</p>
      </article>
    </div>

    <div class="toolbar">
      <button @click="store.fetchSuggestions">Actualiser</button>
      <button class="secondary" @click="store.fetchSuggestionSummary">Actualiser synthese</button>
    </div>

    <p v-if="store.suggestionError" class="error">{{ store.suggestionError }}</p>
    <p v-if="store.suggestionSuccess" class="success">{{ store.suggestionSuccess }}</p>

    <div class="card-list">
      <article
        v-for="item in store.suggestionsList"
        :key="item.id"
        class="card"
        :class="{ 'complaint-rejected-text': false }"
      >
        <h4>{{ item.userFullName || "Usager" }}</h4>
        <p>
          <strong>Centre:</strong>
          {{ item.centerName || "Non specifie" }} ({{ item.centerCode || "-" }})
        </p>
        <p>
          <strong>Statut:</strong>
          {{ item.isRead ? "Lue" : "Non lue" }}
        </p>
        <p>{{ item.message }}</p>
        <p><small>{{ store.formatDate(item.createdAt) }}</small></p>

        <div class="actions">
          <button
            v-if="!item.isRead"
            :disabled="store.suggestionActionLoadingId === String(item.id)"
            @click="store.markSuggestionRead(item)"
          >
            {{ store.suggestionActionLoadingId === String(item.id) ? "..." : "Marquer comme lue" }}
          </button>
        </div>
      </article>

      <p v-if="store.suggestionsList.length === 0" class="muted">Aucune observation.</p>
    </div>
  </section>
</template>

<script setup>
import { useDashboardStore } from "../../stores/dashboard";
const store = useDashboardStore();
</script>
