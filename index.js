'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
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

  app.get('/', async (req, res) => {
    let consentUrl = await xero.buildConsentUrl();

    res.send(`Sign in and connect with Xero using OAuth2! <br><a href="${consentUrl}">Connect to Xero</a>`);
  });

  app.get('/callback', async (req, res) => {
    try {
      const url = 'http://localhost:5000/' + req.originalUrl;
      await xero.setAccessTokenFromRedirectUri(url);

      const token = await xero.readTokenSet();

      req.session.token = token;
      req.session.accessToken = token.access_token;
      req.session.idToken = token.id_token;
      req.session.allTenants = xero.tenantIds;
      req.session.activeTenant = xero.tenantIds[0];
    } catch (e) {
      console.log(e);
      res.json(e);
    } finally {
      res.redirect('/task-prompt');
    }
  });

  app.get('/task-prompt', (req, res) => {
    res.send(`
      <h1>Task 1: Create an invoice</h1>
      <ol>
        <li>Create an item call 'Surfboard' with a sale price of $520.99</li>
        <li>Create an item call 'Skateboard' with a sale price of $124.30</li>
        <li>Create a sales invoice for 4 Surfboards and 5 Skateboards, selling them to a new contact, Rod Drury</li>
        <li>Record a payment for the full amount against the invoice</li>
        <li>Note the InvoiceID of the invoice</li>
      </ol>
      <button><a href='/execute'>EXECUTE?</a></button>
    `);
  });

  app.get('/execute', async (req, res) => {
    try {
      const token = req.session.token;
      await xero.setTokenSet(token);

      const surfboardItem = {
        code: 'surfboard-001',
        name: 'Surfboard',
        description: 'purchase surfboard',
        purchaseDescription: 'purchase surfboard',
        purchaseDetails: {
          unitPrice: 375.5000,
          taxType: 'NONE',
          accountCode: '500',
        },
        salesDetails: {
          unitPrice: 520.9900,
          taxType: 'NONE',
          accountCode: '400',
        }
      };

      const skateboardItem = {
        code: 'skateboard-002',
        name: 'Skateboard',
        description: 'purchase skateboard',
        purchaseDescription: 'purchase skateboard',
        purchaseDetails: {
          unitPrice: 75.0000,
          taxType: 'NONE',
          accountCode: '500',
        },
        salesDetails: {
          unitPrice: 124.3000,
          taxType: 'NONE',
          accountCode: '400',
        }
      };

      const newContact = {
        name: 'Boards by Land and by Sea',
        firstName: 'Rod',
        lastName: 'Drury',
        emailAddress: 'rod.drury@bls.com',
        accountNumber: '555555555'
      };

      const createSurfboardResponse = await xero.accountingApi.createItem(req.session.activeTenant, surfboardItem);
      console.log(JSON.stringify(createSurfboardResponse.body));

      const createSkateboardResponse = await xero.accountingApi.createItem(req.session.activeTenant, skateboardItem);
      console.log(JSON.stringify(createSkateboardResponse.body));

      const createContactResponse = await xero.accountingApi.createContact(req.session.activeTenant, newContact);
      console.log(JSON.stringify(createContactResponse.body));

      const invoice = {
        type: 'ACCREC',
        contact: {
          contactID: createContactResponse.body.contacts[0].contactID,
          name: createContactResponse.body.contacts[0].name
        },
        currencyCode: 'USD',
        dueDate: '\/Date(1518685950940+0000)\/',
        lineItems: [
          {
            itemCode: createSurfboardResponse.body.items[0].code,
            quantity: 4.0000,
            unitAmount: createSurfboardResponse.body.items[0].salesDetails.unitPrice,
            taxType: createSurfboardResponse.body.items[0].salesDetails.taxType,
            accountCode: createSurfboardResponse.body.items[0].salesDetails.uniaccountCodetPrice,
          },
          {
            itemCode: createSkateboardResponse.body.items[0].code,
            quantity: 5.0000,
            unitAmount: createSkateboardResponse.body.items[0].salesDetails.unitPrice,
            taxType: createSkateboardResponse.body.items[0].salesDetails.taxType,
            accountCode: createSkateboardResponse.body.items[0].salesDetails.accountCode,
          }
        ],
        status: 'AUTHORISED'
      };

      const createInvoiceResponse = await xero.accountingApi.createInvoice(req.session.activeTenant, invoice);
      console.log(JSON.stringify(createInvoiceResponse.body));

      const account = {
        code: '555555555',
        name: 'Boards by Land and by Sea - Bank Account x8',
        type: 'BANK',
        bankAccountNumber: '555555555'
      };

      const payment = {
        account: {
          code: account.code
        },
        invoice: {
          invoiceID: createInvoiceResponse.body.invoices[0].invoiceID
        },
        amount: createInvoiceResponse.body.invoices[0].total
      };

      const createAccountResponse = await xero.accountingApi.createAccount(req.session.activeTenant, account);
      console.log(JSON.stringify(createAccountResponse.body));

      const createPaymentResponse = await xero.accountingApi.createPayment(req.session.activeTenant, payment);
      console.log(JSON.stringify(createPaymentResponse.body));

      res.json([createSurfboardResponse.body, createSkateboardResponse.body, createContactResponse.body, createInvoiceResponse.body, createPaymentResponse.body]);
    } catch (e) {
      console.log(e);
      res.json(e);
    }
  });

  app.listen(app.get('port'), () => {
    console.log(`Your Xero OAuth2 app is running at http://localhost: ${app.get('port')}`);
  });
})();
