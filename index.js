'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const jwtDecode = require('jwt-decode');
const xero_node = require('xero-node');

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirectUrl = process.env.REDIRECT_URI;
const scopes = 'openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access';

const xero = new xero_node.XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(' '),
});

(async () => {

  let app = express();

  app.set('port', (5000))
  app.use(express.static(__dirname + '/public'))
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(session({
    secret: 'something crazy',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
  }));

  const authenticationData = (req, res) => {
    return {
      decodedIdToken: req.session.decodedIdToken,
      decodedAccessToken: req.session.decodedAccessToken,
      tokenSet: req.session.tokenSet,
      allTenants: req.session.allTenants,
      activeTenant: req.session.activeTenant,
    };
  };

  app.get('/', (req, res) => {
    res.send(`<a href='/connect'>Connect to Xero</a>`);
  });

  app.get('/connect', async (req, res) => {
    try {
      const consentUrl = await xero.buildConsentUrl();
      res.redirect(consentUrl);
    } catch (err) {
      res.send('Sorry, something went wrong');
    }
  });

  app.get('/callback', async (req, res) => {
    try {
      const tokenSet = await xero.apiCallback(req.url);
      await xero.updateTenants();
  
      const decodedIdToken = jwtDecode(tokenSet.id_token);
      const decodedAccessToken = jwtDecode(tokenSet.access_token);
  
      req.session.decodedIdToken = decodedIdToken;
      req.session.decodedAccessToken = decodedAccessToken;
      req.session.tokenSet = tokenSet;
      req.session.allTenants = xero.tenants;
      // XeroClient is sorting tenants behind the scenes so that most recent / active connection is at index 0
      req.session.activeTenant = xero.tenants[0];
  
      const authData = authenticationData(req, res);
  
      console.log(authData);
  
      res.redirect('/organisation');
    } catch (err) {
      res.send('Sorry, something went wrong');
    }
  });

  app.get('/organisation', async (req, res) => {
    try {
      const tokenSet = await xero.readTokenSet();
      console.log(tokenSet.expired() ? 'expired' : 'valid');
      const response = await xero.accountingApi.getOrganisations(req.session.activeTenant.tenantId);
      res.send(`Hello, ${response.body.organisations[0].name}`);
    } catch (err) {
      res.send('Sorry, something went wrong');
    }
  });

  app.get('/invoice', async (req, res) => {
    try {
      const contacts = await xero.accountingApi.getContacts(req.session.activeTenant.tenantId);
      console.log('contacts: ', contacts.body.contacts);
      const where = 'Status=="ACTIVE" AND Type=="SALES"';
      const accounts = await xero.accountingApi.getAccounts(req.session.activeTenant.tenantId, null, where);
      console.log('accounts: ', accounts.body.accounts);
      const contact = {
        contactID: contacts.body.contacts[0].contactID
      };
      const lineItem = {
        accountCode: accounts.body.accounts[0].accountID,
        description: 'consulting',
        quantity: 1.0,
        unitAmount: 10.0
      };
      const invoice = {
        lineItems: [lineItem],
        contact: contact,
        dueDate: '2021-09-25',
        date: '2021-09-24',
        type: 'ACCREC'
      };
      const invoices = {
        invoices: [invoice]
      };
      const response = await xero.accountingApi.createInvoices(req.session.activeTenant.tenantId, invoices);
      console.log('invoices: ', response.body.invoices);
      res.json(response.body.invoices);
    } catch (err) {
      res.json(err);
    }
  });
  
  app.get('/contact', async (req, res) => {
    try {
      const contact = {
        name: "Bruce Banner",
        emailAddress: "hulk@avengers.com",
        phones: [
          {
            phoneNumber:'555-555-5555',
            phoneType: 'MOBILE'
          }
        ]
      };
      const contacts = {  
        contacts: [contact]
      }; 
      const response = await xero.accountingApi.createContacts(req.session.activeTenant.tenantId, contacts);
      console.log('contacts: ', response.body.contacts);
      res.json(response.body.contacts);
    } catch (err) {
      res.json(err);
    }
  });

  app.listen(app.get('port'), () => {
    console.log(`Your Xero OAuth2 app is running at http://localhost: ${app.get('port')}`);
  });
})();
