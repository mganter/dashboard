//
// Copyright (c) 2020 by SAP SE or an SAP affiliate company. All rights reserved. This file is licensed under the Apache Software License, v. 2 except as noted otherwise in the LICENSE file
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict'

const _ = require('lodash')
const config = require('../config')
const { decodeBase64, joinMemberRoleAndRoles, splitMemberRolesIntoRoleAndRoles } = require('../utils')
const { isHttpError } = require('../kubernetes-client')
const { dumpKubeconfig } = require('../kubernetes-config')
const { Conflict, NotFound } = require('../errors.js')
const cache = require('../cache')

function toServiceAccountName ({ metadata: { name, namespace } }) {
  return `system:serviceaccount:${namespace}:${name}`
}

function fromResource (project = {}, serviceAccounts = []) {
  const serviceAccountsMetadata = _
    .chain(serviceAccounts)
    .map(serviceAccount => [
      toServiceAccountName(serviceAccount),
      {
        createdBy: _.get(serviceAccount, ['metadata', 'annotations', 'garden.sapcloud.io/createdBy']),
        creationTimestamp: serviceAccount.metadata.creationTimestamp
      }
    ])
    .fromPairs()
    .value()

  return _
    .chain(project)
    .get('spec.members')
    .filter(['kind', 'User'])
    .map(({ name: username, role, roles }) => ({
      username,
      roles: joinMemberRoleAndRoles(role, roles),
      ...serviceAccountsMetadata[username]
    }))
    .value()
}

function readProject (client, namespace) {
  const project = cache.findProjectByNamespace(namespace)
  return client['core.gardener.cloud'].projects.get(project.metadata.name)
}

function createServiceaccount (client, { namespace, name, createdBy }) {
  const body = {
    metadata: {
      name,
      namespace,
      annotations: {
        'garden.sapcloud.io/createdBy': createdBy
      }
    }
  }
  return client.core.serviceaccounts.create(namespace, body)
}

async function deleteServiceaccount (client, { namespace, name }) {
  try {
    return client.core.serviceaccounts.delete(namespace, name)
  } catch (err) {
    if (isHttpError(err, [404, 410])) {
      return { metadata: { name, namespace } }
    }
    throw err
  }
}

async function setProjectMember (client, { namespace, name, roles: memberRoles }) {
  // get project
  const project = await readProject(client, namespace)
  // get project members from project
  const members = [...project.spec.members]
  if (_.find(members, ['name', name])) {
    throw new Conflict(`User '${name}' is already member of this project`)
  }
  const { role, roles } = splitMemberRolesIntoRoleAndRoles(memberRoles)
  members.push({
    kind: 'User',
    name,
    apiGroup: 'rbac.authorization.k8s.io',
    role,
    roles
  })
  const body = {
    spec: {
      members
    }
  }
  return client['core.gardener.cloud'].projects.mergePatch(project.metadata.name, body)
}

async function updateProjectMemberRoles (client, { namespace, name, roles: memberRoles }) {
  // get project
  const project = await readProject(client, namespace)
  // get project members from project
  const members = [...project.spec.members]
  const member = _.find(members, ['name', name])
  if (!member) {
    throw new NotFound(`User '${name}' is not a member of this project`)
  }
  const { role, roles } = splitMemberRolesIntoRoleAndRoles(memberRoles)
  _.assign(member, { role, roles })

  const body = {
    spec: {
      members
    }
  }
  return client['core.gardener.cloud'].projects.mergePatch(project.metadata.name, body)
}

async function unsetProjectMember (client, { namespace, name }) {
  // get project
  const project = await readProject(client, namespace)
  // get project members from project
  const members = [...project.spec.members]
  if (!_.find(members, ['name', name])) {
    return project
  }
  _.remove(members, ['name', name])
  const body = {
    spec: {
      members
    }
  }
  return client['core.gardener.cloud'].projects.mergePatch(project.metadata.name, body)
}

// list, create and remove is done with the user
exports.list = async function ({ user, namespace }) {
  const client = user.client

  // get project
  const project = await readProject(client, namespace)

  // list serviceAccounts
  const { items: serviceAccounts } = await client.core.serviceaccounts.list(namespace)

  // get project members from project
  return fromResource(project, serviceAccounts)
}

exports.get = async function ({ user, namespace, name }) {
  const client = user.client

  // get project
  const project = await readProject(client, namespace)

  const projectName = project.metadata.name

  // find member of project
  const member = _.find(project.spec.members, {
    name,
    kind: 'User'
  })
  if (!member) {
    throw new NotFound(`User ${name} is not a member of project ${projectName}`)
  }
  const [, serviceAccountNamespace, serviceAccountName] = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(name) || []
  if (serviceAccountNamespace === namespace) {
    const serviceaccount = await client.core.serviceaccounts.get(namespace, serviceAccountName)
    const server = config.apiServerUrl
    const secretName = _.first(serviceaccount.secrets).name
    const secret = await client.core.secrets.get(namespace, secretName)
    const token = decodeBase64(secret.data.token)
    const caData = secret.data['ca.crt']
    const clusterName = 'garden'
    const contextName = `${clusterName}-${projectName}-${name}`

    const kind = 'ServiceAccount'
    const kubeconfig = dumpKubeconfig({
      user: serviceAccountName,
      context: contextName,
      cluster: clusterName,
      namespace: serviceAccountNamespace,
      token,
      server,
      caData
    })

    return {
      ...member,
      kind,
      kubeconfig
    }
  }
  return member
}

exports.create = async function ({ user, namespace, body: { name, roles } }) {
  const client = user.client

  const [, serviceaccountNamespace, serviceaccountName] = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(name) || []
  if (serviceaccountNamespace === namespace) {
    await createServiceaccount(client, {
      namespace: serviceaccountNamespace,
      name: serviceaccountName,
      createdBy: user.id
    })
  }

  // assign user to project
  const project = await setProjectMember(client, { namespace, name, roles })
  const { items: serviceAccounts } = await client.core.serviceaccounts.list(namespace)
  return fromResource(project, serviceAccounts)
}

exports.update = async function ({ user, namespace, name, body: { roles } }) {
  const client = user.client

  // update user in project
  const project = await updateProjectMemberRoles(client, { namespace, name, roles })
  const { items: serviceAccounts } = await client.core.serviceaccounts.list(namespace)
  return fromResource(project, serviceAccounts)
}

exports.remove = async function ({ user, namespace, name }) {
  const client = user.client

  // unassign user from project
  const project = await unsetProjectMember(client, { namespace, name })
  const [, serviceaccountNamespace, serviceaccountName] = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(name) || []
  if (serviceaccountNamespace === namespace) {
    await deleteServiceaccount(client, {
      namespace,
      name: serviceaccountName
    })
  }

  const { items: serviceAccounts } = await client.core.serviceaccounts.list(namespace)
  return fromResource(project, serviceAccounts)
}
