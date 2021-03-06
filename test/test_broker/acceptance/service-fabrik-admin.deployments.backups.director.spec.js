'use strict';

const _ = require('lodash');
const logger = require('../../../common/logger');
const app = require('../support/apps').internal;
const config = require('../../../common/config');
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStoreForOob;
const filename = backupStore.filename;
const CONST = require('../../../common/constants');
const utils = require('../../../common/utils');
const ScheduleManager = require('../../../jobs/ScheduleManager');

describe('service-fabrik-admin', function () {
  describe('oob-deployment', function () {
    /* jshint expr:true */
    const base_url = '/admin';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const deployment_name = 'ccdb';
    const root_folder_name = CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME;
    const time = Date.now();
    const started_at = isoDate(time);
    const container = backupStore.containerName;
    const operation_backup = 'backup';
    const operation_restore = 'restore';
    const filenameObject = {
      operation: operation_backup,
      deployment_name: deployment_name,
      backup_guid: backup_guid,
      started_at: time,
      root_folder: root_folder_name
    };
    const restoreFilenameObject = {
      operation: operation_restore,
      deployment_name: deployment_name,
      root_folder: root_folder_name
    };
    const filenameObj = filename.create(filenameObject).name;
    const restoreFileName = filename.create(restoreFilenameObject).name;
    const pathname = `/${container}/${filenameObj}`;
    const restorePathname = `/${container}/${restoreFileName}`;
    const prefix = `${root_folder_name}/${operation_backup}/${deployment_name}.${backup_guid}`;
    const data = {
      backup_guid: backup_guid,
      deployment_name: deployment_name,
      state: 'succeeded',
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED
    };
    const restore_data = {
      state: 'succeeded',
      agent_ip: mocks.agent.ip,
      backup_guid: backup_guid,
      deployment_name: deployment_name
    };
    const agentProperties = {
      username: 'admin',
      password: 'admin',
      provider: {
        name: 'openstack',
        container: config.backup.provider.container
      }
    };
    let timestampStub, uuidv4Stub, scheduleStub;

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    before(function () {
      mocks.reset();
      backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      timestampStub = sinon.stub(filename, 'timestamp');
      uuidv4Stub = sinon.stub(utils, 'uuidV4');
      timestampStub.withArgs().returns(started_at);
      uuidv4Stub.withArgs().returns(Promise.resolve(backup_guid));
      scheduleStub = sinon.stub(ScheduleManager, 'schedule').callsFake(() => Promise.resolve({}));
      return mocks.setup([
        backupStore.cloudProvider.getContainer()
      ]);
    });

    afterEach(function () {
      mocks.reset();
      scheduleStub.resetHistory();
      timestampStub.resetHistory();
      uuidv4Stub.resetHistory();
    });
    after(function () {
      scheduleStub.restore();
      timestampStub.restore();
      uuidv4Stub.restore();
    });

    describe('backup', function () {
      it('should list all backups for ccdb deployment', function () {
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup`)
          .query({
            backup_guid: backup_guid
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body.backups).to.have.length(1);
            expect(res.body.backups[0]).to.eql(data);
            expect(res).to.have.status(200);
            mocks.verify();
          });
      });

      it('should initiate ccdb backup operation successfully', function () {
        mocks.director.getDeploymentVms(deployment_name);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.agent.getInfo(2);
        mocks.agent.startBackup();
        const type = 'online';
        mocks.cloudProvider.upload(pathname, body => {
          expect(body.type).to.equal(type);
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.ON_DEMAND);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(pathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/backup`)
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_backup);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
            mocks.verify();
          });
      });

      it('should return the status of last ccdb backup operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupState = {
          state: 'processing',
          stage: 'Creating volume',
          updated_at: started_at
        };
        mocks.agent.lastBackupOperation(backupState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(backupState);
            mocks.verify();
          });
      });


      it('should list all backups for bosh-sf deployment', function () {
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup`)
          .query({
            backup_guid: backup_guid,
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body.backups).to.have.length(1);
            expect(res.body.backups[0]).to.eql(data);
            expect(res).to.have.status(200);
            mocks.verify();
          });
      });

      it('should initiate bosh-sf deployment backup operation successfully', function () {
        mocks.director.getDeploymentVms(deployment_name);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.agent.getInfo();
        mocks.agent.startBackup();
        const type = 'online';
        logger.debug(`uploading json here:--> ${pathname}`);
        mocks.cloudProvider.upload(pathname, body => {
          expect(body.type).to.equal(type);
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.ON_DEMAND);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(pathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/backup`)
          .send({
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF,
            agent_properties: agentProperties
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_backup);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
          });
      });

      it('should return the status of last bosh-sf deployment backup operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupState = {
          state: 'processing',
          stage: 'Creating volume',
          updated_at: started_at
        };
        mocks.agent.lastBackupOperation(backupState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup/status`)
          .query({
            token: token,
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body).to.eql(backupState);
          });
      });
    });

    describe('restore', function () {
      it('should list restore info for ccdb', function () {
        mocks.cloudProvider.download(restorePathname, restore_data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore`)
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body.restore).to.eql(_.omit(restore_data, 'agent_ip'));
          });
      });

      it('should return 400 Bad Request (no backup_guid or time_stamp given)', function () {
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });

      it('should return 400 Bad Request (invalid backup_guid given)', function () {
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: 'invalid-guid'
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });

      it('should return 400 Bad Request (invalid time_stamp given)', function () {
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            time_stamp: '2017-12-04T07:560:02.203Z'
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });

      it('should initiate ccdb restore operation successfully: backup_guid', function () {
        mocks.director.getDeploymentVms(deployment_name);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        mocks.agent.getInfo();
        mocks.agent.startRestore();
        logger.debug(`uploading json here: ${pathname}`);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: backup_guid
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_restore);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
            mocks.verify();
          });
      });

      it('should return 422 Unprocessable Entity (backup still in progress)', function () {
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, {
          state: 'processing'
        });
        logger.debug(`uploading json here: ${pathname}`);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: backup_guid
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(422);
            mocks.verify();
          });
      });

      it('should return the status of ccdb restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(restoreState);
            mocks.verify();
          });
      });

      it('res should return the status of last ccdb restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(restoreState);
            mocks.verify();
          });
      });

      it('should list restore info for bosh-sf deployment', function () {
        mocks.cloudProvider.download(restorePathname, restore_data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore`)
          .query({
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body.restore).to.eql(_.omit(restore_data, 'agent_ip'));
          });
      });

      it('should initiate bosh-sf deployment restore operation successfully', function () {
        mocks.director.getDeploymentVms(deployment_name);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        mocks.agent.getInfo();
        mocks.agent.startRestore();
        logger.debug(`uploading json here: ${pathname}`);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: backup_guid,
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res).to.have.status(202);
            expect(scheduleStub).to.be.calledOnce;
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_restore);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
          });
      });

      it('should return the status of bosh-sf deployment restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token,
            bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
          })
          .set('Accept', 'application/json')
          .send({
            agent_properties: agentProperties
          })
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body).to.eql(restoreState);
          });
      });

    });
  });
});