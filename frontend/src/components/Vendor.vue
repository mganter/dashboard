<!--
Copyright (c) 2020 by SAP SE or an SAP affiliate company. All rights reserved. This file is licensed under the Apache Software License, v. 2 except as noted otherwise in the LICENSE file

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

<template>
  <span v-if="title">{{ shootZones.length ? `Provider / Region / ${zoneTitle}` : 'Provider / Region' }}</span>
  <!-- we make the tooltip background transparent so that it does not conflict with the cards background -->
  <v-tooltip v-else top color="rgba(0, 0, 0, 1)" content-class="tooltip">
    <template v-slot:activator="{ on }">
      <span v-on="on">
        <infra-icon v-model="shootCloudProviderKind" content-class="mr-2"></infra-icon>
        {{ description }}
      </span>
    </template>
    <v-card>
      <v-list>
        <v-list-item>
          <v-list-item-content class="pa-0">
            <v-list-item-subtitle>Provider</v-list-item-subtitle>
            <v-list-item-title><infra-icon v-model="shootCloudProviderKind" content-class="mr-2"></infra-icon>{{ shootCloudProviderKind }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item>
          <v-list-item-content class="pa-0">
            <v-list-item-subtitle>Region</v-list-item-subtitle>
            <v-list-item-title>{{ shootRegion }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item v-if="shootZones.length">
          <v-list-item-content class="pa-0">
            <v-list-item-subtitle>{{zoneTitle}}</v-list-item-subtitle>
            <v-list-item-title>{{shootZonesText}}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-card>
  </v-tooltip>
</template>

<script>
import join from 'lodash/join'
import InfraIcon from '@/components/VendorIcon'
import { shootItem } from '@/mixins/shootItem'

export default {
  components: {
    InfraIcon
  },
  props: {
    shootItem: {
      type: Object,
      required: true
    },
    title: {
      type: Boolean,
      default: false
    },
    extended: {
      type: Boolean,
      default: false
    }
  },
  mixins: [shootItem],
  computed: {
    shootZonesText () {
      return join(this.shootZones, ', ')
    },
    zoneTitle () {
      if (this.shootZones.length > 1) {
        return 'Zones'
      }
      return 'Zone'
    },
    description () {
      const description = []
      if (this.extended) {
        description.push(this.shootCloudProviderKind)
        description.push(this.shootRegion)
        if (this.shootZones.length > 0) {
          description.push(this.shootZonesText)
        }
      } else {
        description.push(this.shootRegion)
      }

      return join(description, ' / ')
    }
  }
}
</script>

<style lang="scss" scoped>
  .tooltip {
    opacity: 1 !important;
    padding: 0;
  }
</style>
