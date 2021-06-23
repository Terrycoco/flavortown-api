const express = require('express');
const cors = require("cors");
const app = express();
const db = require("./db.js");
const createError = require('http-errors');

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
    next(err);
  }
});


//THIS WILL GROW
//all items -- for popup
app.get('/item/:id', (req, res, next) => {
  const id = JSON.parse(req.params.id); 
  let sql = `select item_id as id, 
                    item as name,   
                    description as descr,
                    pic_url,
                    is_general
                    from items 
             WHERE item_id = $1
             `;
   db.any(sql, id) 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      next(err);
    })
});

//all items -- for editor
app.get('/items', (req, res, next) => {
  let sql = `select item_id as id, 
                    item as name, 
                    main_cat_id as cat_id, 
                    is_parent,
                    is_general, 
                    hide_children, 
                    cat, 
                    sort, 
                    description,
                    pic_url
                    from items 
                    inner join cats 
                    on items.main_cat_id = cats.cat_id 
                    ORDER BY item`;
   db.any(sql) 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      next(err);
    })
});

//for editor dropboxes
app.get('/itemsfiltered/:filter', (req, res, next) => {
  const array = JSON.parse(req.params.filter); //convert to array
  console.log('items passed', array, Array.isArray(array));
  const str = array.join(",");
  const sql = `select item_id as id, 
               item as name, 
               is_parent,
               is_general, 
               main_cat_id as cat_id, 
               cat, 
               hide_children, 
               sort, 
               description 
               from items inner join cats 
               on items.main_cat_id = cats.cat_id 
               WHERE main_cat_id not in(" + str + ") 
               ORDER BY item`;

   console.log('filter sql',sql);
   db.any(sql) 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
       next(err);
    })
});

//all cats
app.get('/cats', (req, res, next) => {
   db.any('select * from cats  ORDER BY cat') 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
       next(err);
    })
});

//get items for one cat for initial FF
app.get("/itemsbycat/:catId", (req, res, next) => {
  const cat_id = req.params.catId;
  if (cat_id) {
    const sql = `
     SELECT
          parent_cat_id as cat_id,
          parent_id,
          parent,
          parent_descr,  
          child_id as id,
          child_sort,
          child as name,
          child_descr as descr,
          hide_children,
          is_parent, 
          is_child,
          child_pic_url
     from parent_items_vw
     where parent_cat_id = $1
     order by parent_cat_id, parent, child_sort, name;`;
  //  console.log(sql);
    db.any(sql, [cat_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
        next(err);
    })
} else {
    let err = new Error('Missing CatId');
    err.status = 400;  //bad user request
    next(err); //go to nearest handler
}
});

//insert new item
app.post("/items/new", (req, res, next) => {
  const {item, cat_id} = req.body; 
  console.log('addding item: ', item, 'cat_id:', cat_id);            
  db.one("INSERT INTO items (item, main_cat_id) VALUES ($1, $2) RETURNING item_id as id, item as name, main_cat_id as cat_id", [item, cat_id])
    .then(data => {
      console.log('item added:', data);
      res.status(200).send(data);
   })
    .catch(err => {
       next(err);
    })
});



//delete item
app.post("/item/delete", (req, res, next) => {
  const {item_id} = req.body; 
  console.log('deleting item: ', item_id);            
  db.none("DELETE from items WHERE item_id = $1", [ item_id] )
    .then(() => {
      console.log('item deleted:', req.body);
      res.end();
   })
    .catch(err => {
      next(err);
    })
});

//insert new pairing - or edit affinity-level
app.post("/pairing/new", (req, res, next) => {
  console.log('adding: ', req.body);
  const {item1_id, catId, item2_id, level=1} = req.body;
  let parent = item1_id;
  let child =item2_id;
  let cid = parseInt(catId);
  const regFriends = [-1,1,2,3,4];
  let sql;


  let lev = parseInt(level);


    //child  add once to group table 
  if (lev === 0 || lev === 9) {
      sql =  `INSERT INTO groups(group_id, member_id, group_type, friend_type) 
            VALUES ($1, $2, $3, $4)
            `;     
      db.none(sql, [parent, child, lev, lev])
      .then(() => {
           res.end();
      })
    

  //ingredient - add to group table
    } else if (lev === 5 ) {
        const validCats = [11,12,13]; //double check this is right category
        if (validCats.includes(cid)) {
        sql =  `INSERT INTO groups(group_id, member_id, group_type, friend_type) 
                VALUES ($1, $2, $3, $4)`;
        db.none(sql, [parent, child, cid, lev])
          .then(() => {
             res.end();
          })
      } else {
          let err = new Error('Wrong main category');
          err.status = 400;  //bad user request
          next(err); //go to nearest handler
      }


  //regular friend just add once!
  } else {
    if (regFriends.includes(lev)) {
      //insert least as the item
      let first = Math.min(item1_id, item2_id);
      let second = Math.max(item1_id, item2_id);
      sql = `INSERT INTO friends(item_id, friend_id, friend_type) 
             VALUES ($1, $2, $3) 
             ON CONFLICT  (item_id, friend_id) 
             DO UPDATE set friend_type = $3`;
      db.none(sql, [first, second, lev])
      .then(() => {
          console.log('pairing added');
          res.end();
      })
    } else {
      let err = new Error('Something went wrong with pairing insert');
      err.status = 400;  //bad user request
      next(err); //go to nearest handler
    }
  }//end if
  res.end();
   // let err = new Error('Something went wrong');
   //  err.status = 400;  //bad user request
   //  next(err); //go to nearest handler
});

app.post("/merge", (req, res, next) => {
   const {keep, lose} = req.body;
   console.log('merging ' + lose + ' into ' + keep);
   db.none("CALL sp_merge_items($1, $2)", [keep, lose])
   .then(() => {
      res.end();
   })
   .catch( err => {
      next(err);
   })
});

//mutual friends - FF
app.get("/mutual/:items", (req, res, next) => {
  const array = JSON.parse(req.params.items); //convert to array
  console.log('fetching friends for ', array, Array.isArray(array));
  const arrlen = array.length;
  // const sql =`
  //     select 
  //     id,
  //     name,
  //     cat_id,
  //     descr,
  //     pic_url,
  //     0 as is_parent,
  //     0 as is_child,
  //     min(friend_type) as friend_type,
  //     count(friend_type) as count
  //     from
  //     friends_search
  //     where search_id = ANY($1)
  //     and friend_type > 0
  //     group by 
  //     id,
  //     name,
  //     cat_id,
  //     descr,
  //     pic_url
  //     HAVING count(*) >= $2
  //     ORDER BY cat_id, name;`;
const sql = `
SELECT
      friends_search.id,
      friends_search.name,
       friends_search.cat_id,
       friends_search.descr,
       friends_search.pic_url,
      0 as is_parent,
      0 as is_child,
      min( friends_search.friend_type) as friend_type
      from
      friends_search
      where search_id in (SELECT
         item_id 
    from items
    where item_id = ANY($1)
    and item_id not in
    (
    select group_id from groups 
      where group_type = 9
      and group_id = ANY($1)
      and member_id = ANY($1)
    ))
      group by 
       friends_search.id,
       friends_search.name,
       friends_search.cat_id,
       friends_search.descr,
       friends_search.pic_url
      HAVING count(*) >= (SELECT
         count(*)
    from items
    where item_id = ANY($1)
    and item_id not in
    (
    select group_id from groups 
      where group_type = 9
      and group_id = ANY($1)
      and member_id = ANY($1)
    ))
    ORDER BY cat_id, name;
`;
   console.log('sql:', sql);
    db.any(sql, [array, arrlen])
    .then(data => {
     // console.log('data:', data);
      res.send(data);
    })

  // if (!Array.isArray(array) || !array.length) {
  // // array does not exist, is not an array, or is empty
  // // ⇒ do not attempt to process array
  //    sql = sql + groupclause + orderclause;
  //   console.log(sql);
  //  } else {
  //    array.forEach((item, index) => {
  //      whereclause = whereclause + item + ','
  //    })
  //    sql = sql + whereclause.slice(0, -1) + ') ' + groupclause + " HAVING count(*) = " + array.length + orderclause;
  //    console.log(sql);
  //  }
   // db.any(sql)
   //  .then(data => {
   //    //console.log('data: ', data);
   //    res.send(data);
   //  })
    .catch(err => {
      next(err);
    })
});

//delete pairing 
app.post("/pairing/delete", (req, res, next) => {
   const {item1_id, item2_id } = req.body;           
   //delete from both tables
     console.log('deleting: ', req.body);
   return db.none("DELETE from friends WHERE (item_id = $1 AND friend_id = $2) OR (friend_id = $1 AND item_id = $2);", [item1_id, item2_id])
    .then(() => {
      return db.none("DELETE from groups WHERE (group_id = $1 AND member_id = $2) OR (member_id = $1 AND group_id = $2);", [item1_id, item2_id])
   }).then(() => {
    res.end();
   })
    .catch((err) => {
       next(err);
   })
});

//get ALL friends - editor
app.get("/friends/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  let sql;
  if (item_id) {
    sql = `select friend_id as id,
     friend_cat_id as cat_id,
     friend as name, 
     friend_type, 
     friend_is_parent as is_parent 
     from all_friends_vw 
     where item_id = $1 
     order by friend`;
   // console.log(sql);
    db.any(sql, [item_id])
    .then(data => {
     // console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
        next(err);
    })
}
});

//get ingredients of combo
app.get("/ingreds/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  if (item_id) {
    db.any("select friend_id as id, friend as name, friend_type from all_friends_vw where item_id = $1 and friend_type=5 order by friend;", [item_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
     next(err);
    })
}
});

//insert new item
app.post("/upditem", (req, res, next) => {
  console.log(req.body);

  const {id, name, is_parent, cat_id, hide_children, sort, description, pic_url, is_general} = req.body;
  console.log('editing item: ', id);
  let parent = (!is_parent) ? 0 : 1;
  let sql =  `UPDATE items 
              set item = $1, 
              main_cat_id = $2, 
              is_parent= $3, 
              hide_children=$4,
              sort=$5,
              description=$6,
              pic_url=$7, 
              is_general = $8
              WHERE item_id = $9`          
  db.none(sql, [name, cat_id, parent, hide_children, sort, description, pic_url, is_general, id] )
    .then(() => {
      console.log('item updated:', req.body);
      res.end();
   })
    .catch(err => {
       next(err);
    })
});

//update combos
app.get("/updcombos", (req, res, next) => {
  db.none("call sp_update_combos()")
  .then( ( ) => {
    res.send(true);
  })
  .catch(err => {
    next(err);
  })
});

//update search table
app.post("/updfriends", (req, res, next) => {
  db.none("call sp_make_friends_search()")
  .then( ( ) => {
    res.send(true);
  })
  .catch(err => {
    next(err);
  })
});


//no route found push to handler
app.use((req, res, next) => {
 const error = new Error(req.url + " Not found")
 error.status = 404;
 next(error);
});


// error handler middleware
app.use((error, req, res, next) => {
  console.log('caught', error);
  res.status(error.status || 500).json({message: error.message});
});


app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));