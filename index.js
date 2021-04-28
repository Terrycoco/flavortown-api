const express = require('express');
const cors = require("cors");
const app = express();
const db = require("./db.js");

//middleware
app.use(express.json());
app.use(cors());

let PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV == 'development') {
  PORT = 5000; //force
}
 



// tests connection and returns Postgres server version,
// if successful; or else rejects with connection error:
async function testConnection() {
    const c = await db.connect(); // try to connect
    c.done(); // success, release connection
    return c.client.serverVersion; // return server version
}


//ROUTES
app.get('/testdb', async(req, res) => {
    try {
     const testdb = await testConnection()
     res.send(testdb);
  } catch (err) {
    console.error(err.message);
  }
});

//all items
app.get('/items', (req, res, next) => {
   db.any('select item_id as id, item as name, main_cat_id as cat_id, cat from items inner join cats on items.main_cat_id = cats.cat_id ORDER BY item;') 
    .then(data => {
      res.send(data);
    })
    .catch(error => {
      console.log('ERROR 44', error);
    })
});

//all cats
app.get('/cats', (req, res, next) => {
   db.any('select * from cats  ORDER BY cat') 
    .then(data => {
      res.send(data);
    })
    .catch(error => {
      console.log('ERROR 55', error);
    })
});

//get items for one cat
app.get("/itemsbycat/:catId", (req, res, next) => {
  const cat_id = req.params.catId;
  if (cat_id) {
    db.any("select item_id as id, item as name, main_cat_id as cat_id from items where main_cat_id = $1 order by item;", [cat_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});



//insert new item
app.post("/items/new", (req, res, next) => {
  const {item, cat_id} = req.body; 
  console.log('addding item: ', item, 'cat_id:', cat_id);            
  db.one("INSERT INTO items (item, main_cat_id) VALUES ($1, $2) RETURNING item_id as id, item as name", [item, cat_id])
    .then(data => {
      console.log('item added:', data);
      res.send(data);
   })
    .catch(error => {
      //TODO: better error handling - how to send error to user?
      console.error('ERROR 70 trying to insert item:', req.body, error.detail);
      res.send(error.detail);
    })
});

//insert new item
app.post("/item/edit", (req, res, next) => {
  const {item_id, cat_id, item} = req.body; 
  console.log('editing item: ', item, 'cat_id:', cat_id);            
  db.none("UPDATE items set item = $1, main_cat_id = $2 WHERE item_id = $3", [item, cat_id, item_id] )
    .then(() => {
      console.log('item updated:', req.body);
      res.end();
   })
    .catch(err => {
      //TODO: better error handling - how to send error to user?
      console.error('ERROR 105 trying to update item:', req.body, err.message);
      res.send(err.message);
    })
});

//insert new pairing - or edit affinity-level
app.post("/pairing/new", (req, res, next) => {
  const {item1_id, item2_id, level=1} = req.body;
  const lesser = Math.min(item1_id, item2_id);
  const greater = Math.max(item1_id, item2_id);              
  db.none("INSERT INTO pairings(item1_id, item2_id, affinity_level) VALUES ($1, $2, $3) ON CONFLICT (item1_id, item2_id) DO UPDATE set affinity_level = $3;", [lesser, greater, level])
    .then(() => {
      res.end();
   })
    .catch((error) => {
       //fallback
       if (error.constraint === 'unique_pairings') {
         return db.none("UPDATE pairings set affinity_level = $3 where (item1_id = $1 and item2_id = $2) OR (item2_id = $1 and item1_id = $2);", [lesser, greater, level])
          .then(() => { 
             res.end();
             return;
         })
 
       } else {
        console.error('ERROR 88', error.detail);

        res.end();
       
        }
   })
});

//update a combo to make sure all ingredients
//go with eachother as friends
app.get("/updcombo/:itemId" , (req, res, next) => {
  const item_id = req.params.itemId;
 
  if (item_id) {
    db.any("select friend_id as id from all_friends_vw where item_id = $1 and item_cat_id = 12 and affinity_level = 5", [item_id])
    .then(ingreds => {

    if (ingreds.length > 1) {
       let i;
       let inner;
       let sql = "INSERT into pairings (item1_id, item2_id) VALUES ";


       for (i=0; i < ingreds.length - 1; i++) {

        //console.log(' i is:', i);

           for (inner=i+1; inner < ingreds.length; inner++) {

            // console.log('got here inner is:', inner);
              sql = sql + "(" + ingreds[i].id + "," + ingreds[inner].id + "),";
           }
        }

        
         //removelast comma
         sql = sql.slice(0, -1);
         sql = sql + ' ON CONFLICT DO NOTHING';
          console.log('ending sql', sql);

          return db.any(sql)
          .then(() => {
            console.log('done')
            res.send('done');
            return;
          })
          .catch(err => {
            console.error(err.detail);
          });
      
    } else {
      //do nothing
      res.end();
    }
  })
  .catch(err => {
     res.send(err.detail);
  });

} else {
  //do nothing
  res.end();
}

});


//delete pairing 
app.post("/pairing/delete", (req, res, next) => {
  const {item1_id, item2_id } = req.body;           
  db.none("DELETE from pairings WHERE (item1_id = $1 AND item2_id = $2) OR (item2_id = $1 AND item1_id = $2);", [item1_id, item2_id])
    .then(() => {
      res.end();
   })
    .catch((error) => {
       //fallback
        console.error('ERROR 88', error.detail);

        res.end();

   })
});



//get friends
app.get("/friends/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  if (item_id) {
    db.any("select friend_id as id, friend as name, affinity_level from all_friends_vw where item_id = $1 order by friend;", [item_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});

//get ingredients of combo
app.get("/ingreds/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  if (item_id) {
    db.any("select friend_id as id, friend as name, affinity_level from all_friends_vw where item_id = $1 and affinity_level=5 order by friend;", [item_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});



//mutual friends
app.get("/mutual/:items", (req, res, next) => {
  const array = JSON.parse(req.params.items); //convert to array
  console.log('items passed', array, Array.isArray(array));

  let sql = `select friend_id as id, friend as name, friend_cat as cat, friend_cat_id as cat_id, min(affinity_level) as min_affinity from friends_with_cats_vw`;
  let whereclause = ' WHERE item_id IN(';
  let groupclause = " and affinity_level > 0 GROUP BY friend_cat, friend_cat_id, friend_id, friend ";
  let orderclause = " ORDER BY friend_cat, friend ";

  if (!Array.isArray(array) || !array.length) {
  // array does not exist, is not an array, or is empty
  // ⇒ do not attempt to process array
     sql = sql + groupclause + orderclause;
    console.log(sql);
   } else {
     array.forEach((item, index) => {
       whereclause = whereclause + item + ','
     })
     sql = sql + whereclause.slice(0, -1) + ') ' + groupclause + " HAVING count(*) = " + array.length + orderclause;
     console.log(sql);
   }
   db.any(sql)
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 179', error.detail);
        res.send(error.detail);
    })
});


app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));