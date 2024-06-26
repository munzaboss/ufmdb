const express = require('express');
const app = express();
const oracledb = require('oracledb');
const path = require('path');
const cors = require('cors');

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.path);
  next();
});


const config = {
    user: 'jeremymartin',
    password: '5l5MkBXtir5rcdiFaSl5tsXX',
    connectString: 'oracle.cise.ufl.edu:1521/orcl'
  };

const getDiversity = async (genre) => {
  console.log('executing getDiversity with genre:', genre);
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      WITH ReleaseCounts AS (
        SELECT
            m.id AS movie_id,
            COUNT(r.id) AS num_releases,
            r.rdate as releasedate
        FROM
            jeremymartin.movies m
        JOIN jeremymartin.releases r ON r.id = m.id
        GROUP BY
            m.id, r.rdate
      )
      SELECT 
          year,
          AVG(num_languages) AS avg_num_languages,
          AVG(rating) AS avg_rating,
          gen
      FROM 
          (SELECT 
              m.id,
              m.year,
              m.rating,
              COUNT(DISTINCT l.language) AS num_languages,
              g.genre AS gen
          FROM 
              jeremymartin.movies m
          JOIN 
              jeremymartin.languages l ON m.id = l.id
          JOIN
              jeremymartin.genres g ON g.id = m.id
          JOIN 
              ReleaseCounts RC ON RC.movie_id = m.id
          WHERE 
              g.genre = :genre
          GROUP BY 
              m.id, m.year, m.rating, g.genre)
      WHERE
          year > 1940 AND year < 2023 AND
          rating IS NOT NULL
      GROUP BY 
          year, gen
      ORDER BY 
          year`;

    const result = await conn.execute(sql, [genre], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      year: row.YEAR,
      avgNumLanguages: row.AVG_NUM_LANGUAGES,
      avgRating: row.AVG_RATING,
      genre: row.GEN
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}


const getVeteranCrewImpact = async (role, minYearsInIndustry, minMovieCount) => {
  console.log('executing getVeteranCrewImpact with crew:', role);
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
    WITH VeteranCrew AS
    (
    SELECT c.Name, c.role, MAX(m.year) - MIN(m.year) AS YearsInIndustry, COUNT( * ) AS MovieCount
    FROM jeremymartin.crew c
    JOIN jeremymartin.movies m ON m.ID = c.ID
    WHERE 
        m.Year IS NOT NULL AND
        c.role = :role --variable
    GROUP BY c.Name, c.role
    HAVING (MAX(m.year) - MIN(m.year)) > :minYearsInIndustry AND COUNT( * ) > :minMovieCount
    ORDER BY MAX(m.year) - MIN(m.year) DESC
    ),
    MoviesWithVeteran AS
    (
    SELECT DISTINCT
        c.ID,
        m.year,
        m.rating
    FROM 
        jeremymartin.crew c,
        VeteranCrew vc,
        jeremymartin.movies m
    WHERE c.Name = vc.Name AND c.role = vc.Role AND m.id = c.ID AND m.rating IS NOT NULL
    ORDER BY m.year DESC
    ),
    MoviesWithoutVeteran AS
    (
        SELECT
                c.ID,
                m.year,
                m.rating
        FROM jeremymartin.crew c
        JOIN jeremymartin.movies m ON m.ID = c.ID
        WHERE m.rating IS NOT NULL
        MINUS
        SELECT
            mv.ID,
            mv.year,
            mv.rating
        FROM MoviesWithVeteran mv
    ),
    VeteranMovieRatingsPerYear AS
    (
    SELECT 
        mv.year,
        ROUND(AVG(mv.rating),2) AS Average_Rating,
        COUNT( * ) AS numMovies,
        1 AS HasVeteran
    FROM MoviesWithVeteran mv
    GROUP BY mv.year
    ORDER BY mv.year
    ),
    NonVeteranMovieRatingsPerYear AS
    (
    SELECT
        mov.year,
        ROUND(AVG(mov.rating),2) AS Average_Rating,
        COUNT( * ) AS numMovies,
        0 AS HasVeteran
    FROM MoviesWithoutVeteran mov
    GROUP BY mov.year
    ORDER BY mov.year
    )
    
    SELECT
        v.year AS year,
        v.numMovies AS Veteran_Movie_Count,
        n.numMovies AS NonVeteran_Movie_Count,
        v.Average_Rating AS VeteranAverageRating,
        n.Average_Rating AS NonVeteranAverageRating,
        v.Average_Rating - n.Average_Rating AS Rating_Differential
    
    FROM VeteranMovieRatingsPerYear v
    JOIN NonVeteranMovieRatingsPerYear n ON v.year = n.year
    ORDER BY v.year    
          `;

    const result = await conn.execute(sql, {
      role: role,
      minYearsInIndustry: minYearsInIndustry,
      minMovieCount: minMovieCount
    }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      year: row.YEAR,
      Veteran_Movie_Count: row.VETERAN_MOVIE_COUNT,
      NonVeteran_Movie_Count: row.NONVETERAN_MOVIE_COUNT,
      VeteranAverageRating: row.VETERANAVERAGERATING,
      NonVeteranAverageRating: row.NONVETERANAVERAGERATING,
      RatingDifferential: row.RATING_DIFFERENTIAL,
      CrewRole: role
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

// gets GC, computed daily
const getGenreComplexitiesDly = async (genre) => {
  // console.log('executing getGenreComplexities with genre:', genre);
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      WITH mgt(id, name, m_cplx, genre, theme_count, rating, rdate, genre_count, rn, rk) AS (
        SELECT m.id, m.name, (t.tc * (m.rating / 5)), g.genre, t.tc, m.rating, r.rdate, gc.gc,
        ROW_NUMBER() OVER (ORDER BY r.rdate DESC) AS rn,
        RANK() OVER (ORDER BY r.rdate DESC) AS rk
        FROM jeremymartin.movies m 
        JOIN (
            SELECT DISTINCT id, MIN(rdate) AS rdate
            FROM jeremymartin.releases 
            GROUP BY id
        ) r ON m.id = r.id
        JOIN (
            SELECT DISTINCT id, genre
            FROM jeremymartin.genres 
            WHERE genre = :genre
            GROUP BY id, genre
        ) g ON m.id = g.id
        JOIN (
            SELECT  id, COUNT(DISTINCT theme) AS tc
            FROM jeremymartin.themes
            GROUP BY id
        ) t on m.id = t.id
        JOIN (
            SELECT id, COUNT(DISTINCT genre) AS gc
            FROM jeremymartin.genres 
            GROUP BY id
        ) gc ON m.id = gc.id
        WHERE m.rating IS NOT NULL AND t.tc IS NOT NULL
    ), 
    ema (name, rdate, genre, m_cplx, rn, g_cplx) AS (
        SELECT name, rdate, genre, m_cplx, rn, m_cplx 
        FROM mgt
        WHERE rn = 1
        UNION ALL
        SELECT m.name, m.rdate, m.genre, m.m_cplx, m.rn, 
        (2/m.rk)*(m.m_cplx - e.g_cplx) + e.g_cplx 
        FROM mgt m, ema e 
        WHERE m.rn = e.rn + 1 AND m.genre = e.genre
    )
    SELECT name, rdate, genre, m_cplx, g_cplx
    FROM ema
    ORDER BY rdate DESC
          `;

    const result = await conn.execute(sql, [genre], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      genre: row.GENRE,
      rdate: row.RDATE,
      movie: row.NAME,
      movie_complexity: row.M_CPLX,
      genre_complexity: row.G_CPLX
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

// gets GC, computed monthly
const getGenreComplexitiesMty = async (genre) => {
  // console.log('executing getGenreComplexities with genre:', genre);
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      WITH mgt(id, name, mcplx, theme_count, rating, ryear, rmth, genre) AS (
        SELECT m.id, m.name, (t.tc * (m.rating / 5)), t.tc, m.rating, EXTRACT(YEAR FROM rdate), EXTRACT(MONTH FROM rdate), g.genre
        FROM jeremymartin.movies m 
        JOIN (
            SELECT DISTINCT id, MIN(rdate) AS rdate
            FROM jeremymartin.releases 
            GROUP BY id
        ) r ON m.id = r.id
        JOIN (
            SELECT DISTINCT id, genre
            FROM jeremymartin.genres 
            WHERE genre = :genre
            GROUP BY id, genre
        ) g ON m.id = g.id
        JOIN (
            SELECT  id, COUNT(DISTINCT theme) AS tc
            FROM jeremymartin.themes
            GROUP BY id
        ) t on m.id = t.id
        WHERE m.rating IS NOT NULL 
        AND t.tc IS NOT NULL
      ), 
      aggmgt (genre, ryear, rmth, amc, rn, rk) AS (
          SELECT genre, ryear, rmth, AVG(mcplx), 
              ROW_NUMBER() OVER (ORDER BY ryear DESC, rmth DESC) AS rn, 
              RANK() OVER (ORDER BY ryear DESC, rmth DESC) AS rk
          FROM mgt
          GROUP BY ryear, rmth, genre
      ),
      ema (genre, ryear, rmth, amc, rn, agc) AS (
          SELECT genre, ryear, rmth, amc, rn, amc 
          FROM aggmgt 
          WHERE rn = 1
          UNION ALL
          SELECT m.genre, m.ryear, m.rmth, m.amc, m.rn, 
          (2/m.rk)*(m.amc - e.agc) + e.agc 
          FROM aggmgt m, ema e 
          WHERE m.rn = e.rn + 1 
      )
      SELECT genre, TO_DATE(LPAD(rmth, 2, '0') || ryear, 'MMYYYY') AS rdate, amc, agc
      FROM ema
      ORDER BY rdate DESC
          `;

    const result = await conn.execute(sql, [genre], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      genre: row.GENRE,
      rdate: row.RDATE,
      movie_complexity: row.AMC,
      genre_complexity: row.AGC
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}
// gets GC, computed yearly, for any number of years
const getGenreComplexitiesYrly = async (genre, years) => {
  // console.log('executing getGenreComplexities with genre:', genre);
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      WITH mgt(id, name, mcplx, theme_count, rating, ryear, genre) AS (
        SELECT m.id, m.name, (t.tc * (m.rating / 5)), t.tc, m.rating, EXTRACT(YEAR FROM rdate), g.genre
        FROM jeremymartin.movies m 
        JOIN (
            SELECT DISTINCT id, MIN(rdate) AS rdate
            FROM jeremymartin.releases 
            GROUP BY id
        ) r ON m.id = r.id
        JOIN (
            SELECT DISTINCT id, genre
            FROM jeremymartin.genres 
            WHERE genre = :genre
            GROUP BY id, genre
        ) g ON m.id = g.id
        JOIN (
            SELECT  id, COUNT(DISTINCT theme) AS tc
            FROM jeremymartin.themes
            GROUP BY id
        ) t on m.id = t.id
        WHERE m.rating IS NOT NULL 
        AND t.tc IS NOT NULL
      ), 
      aggmgt (genre, ryear, amc, rn, rk) AS (
          SELECT genre, ryear, AVG(mcplx), 
              ROW_NUMBER() OVER (ORDER BY TRUNC(ryear / :years) * :years DESC) AS rn, 
              RANK() OVER (ORDER BY TRUNC(ryear / 1) * 1 DESC) AS rk
          FROM mgt
          GROUP BY ryear, genre
      ),
      ema (genre, ryear, amc, rn, agc) AS (
          SELECT genre, ryear, amc, rn, amc 
          FROM aggmgt 
          WHERE rn = 1
          UNION ALL
          SELECT m.genre, m.ryear, m.amc, m.rn, 
          (2/m.rk)*(m.amc - e.agc) + e.agc 
          FROM aggmgt m, ema e 
          WHERE m.rn = e.rn + 1 
      )
      SELECT genre, ryear, amc, agc
      FROM ema
      ORDER BY ryear DESC
          `;

    const result = await conn.execute(sql, { genre, years }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      genre: row.GENRE,
      rdate: row.RYEAR.toString(),
      movie_complexity: row.AMC,
      genre_complexity: row.AGC
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

const getGenreMarketShareByCountry = async (genre, country) => {
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      WITH
      ranked_genres_per_country AS (
        SELECT
          Country,
          Genre,
          yor,
          COUNT(*) AS num_movies_in_genre_for_year
        FROM (
          SELECT DISTINCT
            g.ID,
            r.Country,
            g.genre,
            EXTRACT(YEAR FROM r.rdate) AS yor
          FROM jeremymartin.genres g
          JOIN jeremymartin.releases r ON r.id = g.id
          WHERE g.genre = :genre AND r.Country = :country
        )
        GROUP BY Country, Genre, yor
      ),
      totalMoviesPerCountry AS (
        SELECT
          Country,
          yor,
          COUNT(*) AS TotalMoviesForYear
        FROM (
          SELECT DISTINCT
            r.Country,
            r.ID,
            EXTRACT(YEAR FROM r.rdate) AS yor
          FROM jeremymartin.releases r
          WHERE r.Country = :country
        )
        GROUP BY Country, yor
      )
      SELECT
        rg.Country,
        rg.Genre,
        rg.yor AS "Year of Release",
        rg.num_movies_in_genre_for_year AS "Number of Movies in Genre",
        tmc.TotalMoviesForYear AS "Total Movies in Country",
        ROUND(100 * rg.num_movies_in_genre_for_year / tmc.TotalMoviesForYear, 2) AS "Genre Percentage"
      FROM ranked_genres_per_country rg
      JOIN totalMoviesPerCountry tmc ON rg.Country = tmc.Country AND rg.yor = tmc.yor
      WHERE rg.Genre = :genre AND rg.Country = :country
      ORDER BY rg.Country, rg.Genre, rg.yor
    `;

    const result = await conn.execute(sql, { genre, country }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(row => ({
      country: row.Country,
      genre: row.Genre,
      yearOfRelease: row['Year of Release'],
      moviesInGenre: row['Number of Movies in Genre'],
      totalMovies: row['Total Movies in Country'],
      genreMarketShare: row['Genre Percentage']
    }));
  } catch (err) {
    console.error('Error executing query:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

app.get('/get-average-role-percentage/:roleName', async (req, res) => {
  const { roleName } = req.params;

  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
      SELECT AVG(role_percentage) AS average_role_percentage
      FROM (
        SELECT
          100.0 * COUNT(CASE WHEN c.role = :roleName THEN 1 END) / NULLIF(COUNT(*), 0) AS role_percentage
        FROM crew c
        GROUP BY c.id
      )`;

    const result = await conn.execute(sql, [roleName], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    // console.log('Result:', result);
    if (result.rows.length > 0) {
      // Directly send percentages as top-level array of single values
      const percentages = result.rows.map(row => row.AVERAGE_ROLE_PERCENTAGE || 0); // Ensuring no undefined values
      res.json(percentages); // Send as an object for clearer structure
    } else {
      res.status(404).send('No data found');
    }
  } catch (err) {
    console.error('Error executing query:', err);
    res.status(500).send('Internal Server Error');
  } finally {
    if (conn) {
      await conn.close();
    }
  }
});


// this is literally just getting popularity
app.get('/get-movie-popularity/:movieId', async (req, res) => {
  const { movieId } = req.params;
  // const movieId = 1000001;

  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
    SELECT 
    movie_id,
    movie_name,
    popularity
    FROM (
        SELECT 
            m.id AS movie_id,
            m.name AS movie_name,
            (COUNT(r.id) + (2 * m.rating)) AS popularity
        FROM 
            movies m
        LEFT JOIN 
            releases r ON m.id = r.id
        GROUP BY 
            m.id, m.name, m.rating
    ) t
    WHERE
        popularity IS NOT NULL
        AND movie_id = :movieId
    ORDER BY
        popularity DESC`;

        console.log("Executing SQL:", sql);
        console.log("With parameters:", { movieId });

    const result = await conn.execute(sql, [movieId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    // console.log('Result:', result);
    if (result.rows.length > 0) {
      const moviePopularity = result.rows.map(row => ({
        movieId: row.MOVIE_ID,  // Accessing the MOVIE_ID property
        movieName: row.MOVIE_NAME,  // Accessing the MOVIE_NAME property
        popularity: ((row.POPULARITY - 3.38) / (164.7 - 3.38)) * 10  // Normalizing the POPULARITY property to be between 0 and 10
      }));
      // console.log('Movies:', moviePopularity);
      res.json(moviePopularity);  // Sending the array of movie objects
  }} catch (err) {
    console.error('Error executing query:', err);
    res.status(500).send('Internal Server Error');
  } finally {
    if (conn) {
      await conn.close();
    }
  }
});

const getAverageRolePercentage = async (roleName) => {
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
    SELECT 
    EXTRACT(MONTH FROM release_date) AS month,
    EXTRACT(YEAR FROM release_date) AS year,
    AVG(role_percentage) AS average_role_percentage
FROM (
    SELECT
        100.0 * COUNT(CASE WHEN c.role = :roleName THEN 1 END) / NULLIF(COUNT(*), 0) AS role_percentage,
        c.id,
        r.rdate as release_date
    FROM crew c
    JOIN releases r ON c.id = r.id
    GROUP BY c.id, r.rdate
)
GROUP BY EXTRACT(MONTH FROM release_date), EXTRACT(YEAR FROM release_date)
ORDER BY year, month`;

    const result = await conn.execute(sql, [roleName], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    if (result.rows.length > 0) {
      const percentages = result.rows.map(row => ({
        month: row.MONTH,
        year: row.YEAR,
        average_role_percentage: row.AVERAGE_ROLE_PERCENTAGE || 0,
      }));
      console.log('percentages:', percentages);
      return percentages;
    } else {
      return null; // Or handle no data found case accordingly
    }
  } catch (err) {
    console.error('Error executing query:', err);
    return null; // Or handle error accordingly
  } finally {
    if (conn) {
      await conn.close();
    }
  }
};

// this is literally just getting popularity
const getMonthlyAveragePopularity = async () => {
  let conn;
  try {
    conn = await oracledb.getConnection(config);

    const sql = `
    SELECT 
        EXTRACT(MONTH FROM rdate) AS month,
        EXTRACT(YEAR FROM rdate) AS year,
        AVG(popularity) AS average_popularity
    FROM (
        SELECT 
            m.id AS movie_id,
            m.name AS movie_name,
            r.rdate,
            (COUNT(r.id) + (2 * m.rating)) AS popularity
        FROM 
            movies m
        LEFT JOIN 
            releases r ON m.id = r.id
        GROUP BY 
            m.id, m.name, m.rating, r.rdate
    ) t
    WHERE
        popularity IS NOT NULL
    GROUP BY 
        EXTRACT(MONTH FROM rdate), EXTRACT(YEAR FROM rdate)
    ORDER BY 
        year, month`;

    const result = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    if (result.rows.length > 0) {
      const monthlyPopularity = result.rows.map(row => ({
        month: row.MONTH,
        year: row.YEAR,
        popularity: ((row.AVERAGE_POPULARITY - 3.38) / (164.7 - 3.38)) * 10
      }));
      console.log('monthlyPopularity:', monthlyPopularity);
      return monthlyPopularity;
    } else {
      return null; // Or handle no data found case accordingly
    }
  } catch (err) {
    console.error('Error executing query:', err);
    return null; // Or handle error accordingly
  } finally {
    if (conn) {
      await conn.close();
    }
  }
};

app.get('/get-role-importance/:roleName', async (req, res) => {
  const { roleName } = req.params;

  try {
    const roleImportanceData = await getRoleImportance(roleName);
    console.log('roleImportanceData:', roleImportanceData);
    res.json(roleImportanceData); // Send the role importance data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const getRoleImportance = async (roleName) => {
  const avgRolePercentage = await getAverageRolePercentage(roleName);
  const monthlyAvgPopularity = await getMonthlyAveragePopularity();

  const roleImportanceData = monthlyAvgPopularity.map((data) => {
    const { month, year, popularity } = data;
    const rolePercentage = avgRolePercentage.find((role) => role.year === year && role.month === month);
    const importanceScore = rolePercentage ? rolePercentage.average_role_percentage * popularity : 0;
    

    return {
      month,
      year,
      importanceScore,
    };
  });

  return roleImportanceData;
};


 
  
app.get('/get-movie/:movieId', async (req, res) => {
  const { movieId } = req.params;

  try {
    const movieData = await getMovie(movieId);
    res.json(movieData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/get-barbie', async (req, res) => {
  console.log('r')
  // const { movieId } = req.params.movieId;

  try {
    const movieData = await getMovie(1000001);
    res.json(movieData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.get('/api/test', async (req, res) => {
  res.json({ message: 'Hello from the server!' });
})


// here are the important queries

//Vetquery Muneeb

app.get('/get-vetcrew/:role/:minYearsInIndustry/:minMovieCount', async (req, res) => {
  console.log('req.params:', req.params);
  const { role, minYearsInIndustry, minMovieCount } = req.params;
  console.log('role:', role);
  console.log('minYearsInIndustry:', minYearsInIndustry);
  console.log('minMovieCount:', minMovieCount);

  try {
    const VeteranData = await getVeteranCrewImpact(role, minYearsInIndustry, minMovieCount);
    res.json(VeteranData); // Send the data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// vedic first

app.get('/get-diversity/:genre', async (req, res) => {
  console.log('req.params:', req.params);
  const { genre } = req.params;
  console.log('genre:', genre);

  try {
    const diversityData = await getDiversity(genre);
    res.json(diversityData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/get-genre-complexity/:genre', async (req, res) => {
  console.log('req.params:', req.params);
  const { genre } = req.params;

  try {
    const GCData = await getGenreComplexitiesDly(genre);
    res.json(GCData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/get-genre-complexity-monthly/:genre', async (req, res) => {
  console.log('req.params:', req.params);
  const { genre } = req.params;

  try {
    const GCData = await getGenreComplexitiesMty(genre);
    res.json(GCData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/get-genre-complexity-yearly/:genre/:years', async (req, res) => {
  console.log('req.params:', req.params);
  const { genre, years } = req.params;

  try {
    const GCData = await getGenreComplexitiesYrly(genre, years);
    res.json(GCData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/get-market-share/:genre/:country', async (req, res) => {
  console.log('req.params:', req.params);
  const { genre, country } = req.params;
  // console.log('genre:', genre);

  try {
    const GMData = await getGenreMarketShareByCountry(genre, country);
    // console.log('GMData:', GMData);
    res.json(GMData); // Send the movie data back to the frontend
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DO NOT MOVE THIS. DO NOT PUT ANY OTHER ROUTES BELOW THIS, IT WILL BREAK THE WHOLE THING
app.use(express.static(path.join(__dirname, '../../build')));       
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../build', 'index.html'));
});


async function run() {
  let connection;

  try {
    // connection = await oracledb.getConnection(config);

    // await conn.close();
    // const result = await connection.execute(
    //   `SELECT * FROM Movies WHERE id = :id`,
    //   [1000001]
    // );
    // const result = await getDiversity('Action');
    // console.log(result);

    // console.log(result.rows);

  } catch (err) {
    console.error('Caught an error!' , err);
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

run();